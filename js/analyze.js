// Per-function verdicts. Mirrors cli/turbo_cli.py analyze_file()/classify()
// and docs/analyze.md, as a line scanner (v0). v1 runs the real CLI under
// Pyodide so there is one implementation of the rules.
//
// Conservative in the same direction as the CLI: anything it cannot see
// through lands in a lower bucket, never a higher one.

// MEASURED from cli/turbo_cli.py: viper against the SAME integer source run as
// bytecode. That is the comparison this page performs, so it is the only one
// that can be quoted before a run without the estimate contradicting the
// measurement afterwards.
//
// Do not use the larger numbers in turbo-cli.md 2.7 (RP2040 36.3x, RP2350
// 24.4x, C5 44.0x). Those are viper against a FLOAT bytecode implementation,
// a different baseline: they include the gain from rewriting the algorithm in
// fixed point, which the page does not do for you.
//
// Confirmed on hardware 2026-09-07: a Feather RP2040 on turbo firmware ran the
// example at 8335 ms from /src and 422 ms from /lib/turbo/armv6m, 19.8x, next
// to the 19.7x below. The 422 ms also matches the farm's Metro RP2040.
//
// No entry means no number is printed; never interpolate a speedup.
export const MEASURED = {
  armv6m:    { x: 19.7, board: "the Metro RP2040" },
  armv7m:    null,
  armv7em:   null,
  armv7emsp: { x: 16.3, board: "the Metro RP2350" },
  armv7emdp: null,
  xtensa:    null,
  xtensawin: { x: 26.2, board: "the Metro ESP32-S3" },
  rv32imc:   null,
};

const IO_ROOTS = new Set([
  "board", "digitalio", "analogio", "busio", "pwmio", "touchio", "rotaryio",
  "countio", "neopixel", "displayio", "framebufferio", "terminalio",
  "audiocore", "audiobusio", "audiopwmio", "storage", "microcontroller",
  "usb_cdc", "usb_hid", "wifi", "socketpool", "ssl", "supervisor",
]);
const SAFE_CALLS = new Set(["len", "range", "int", "abs", "min", "max", "ord", "chr", "bool"]);
const BUFFERS = new Set(["bytearray", "bytes", "array", "memoryview"]);
const STR_METHODS = new Set(["join", "format", "split", "strip", "encode", "decode",
  "replace", "startswith", "endswith", "upper", "lower"]);
const GROW = new Set(["append", "extend", "insert", "pop", "remove", "add", "update", "setdefault"]);
const BUILTINS = new Set([
  "True", "False", "None", "len", "range", "int", "float", "str", "bytes", "bytearray",
  "abs", "min", "max", "sum", "ord", "chr", "bool", "list", "dict", "tuple", "set",
  "enumerate", "zip", "print", "round", "pow", "divmod", "sorted", "reversed", "isinstance",
  "memoryview", "array", "type", "repr", "hex", "bin", "oct", "iter", "next", "getattr",
  "setattr", "hasattr", "Exception", "ValueError", "TypeError", "OSError", "IndexError",
  "KeyError", "RuntimeError", "StopIteration", "self",
]);

const KEYWORDS = new Set([
  "def", "return", "if", "elif", "else", "for", "while", "break", "continue", "pass",
  "import", "from", "as", "in", "is", "not", "and", "or", "global", "nonlocal", "lambda",
  "try", "except", "finally", "raise", "with", "yield", "class", "assert", "del", "await", "async",
]);

// Strip strings and comments so the scanner never trips on their contents.
function strip(line) {
  let out = "", i = 0, q = null;
  while (i < line.length) {
    const c = line[i];
    if (q) {
      if (c === "\\") { i += 2; continue; }
      if (c === q) q = null;
      out += " ";
      i++;
      continue;
    }
    if (c === '"' || c === "'") { q = c; out += " "; i++; continue; }
    if (c === "#") break;
    out += c;
    i++;
  }
  return out;
}

function indentOf(line) {
  const m = /^[ \t]*/.exec(line);
  return m[0].replace(/\t/g, "        ").length;
}

// Top-level `def name(args):` blocks, with their extent.
export function findFunctions(text) {
  const lines = text.split(/\r?\n/);
  const fns = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[i]);
    if (!m) continue;
    // decorators immediately above belong to the def
    let start = i;
    while (start > 0 && /^@/.test(lines[start - 1])) start--;
    // header may wrap over several lines; find the line ending in ':'
    let head = i;
    let depth = 0, sawColon = false;
    for (; head < lines.length; head++) {
      const s = strip(lines[head]);
      for (const c of s) {
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === ":" && depth === 0) sawColon = true;
      }
      if (sawColon) break;
    }
    // body ends at the next line at column 0 that is not blank or a comment
    let end = head;
    for (let j = head + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (!raw.trim()) continue;
      if (indentOf(raw) === 0 && !/^\s*#/.test(raw)) break;
      end = j;
    }
    fns.push({
      name: m[1],
      line: start + 1,           // 1-based, includes decorators
      defLine: i + 1,
      headEnd: head + 1,
      endLine: end + 1,
      decorators: lines.slice(start, i).map((l) => l.trim()),
      header: lines.slice(i, head + 1).join("\n"),
      body: lines.slice(head + 1, end + 1),
      text: lines.slice(start, end + 1).join("\n"),
    });
    i = end;
  }
  return fns;
}

function params(header) {
  const open = header.indexOf("(");
  const close = header.lastIndexOf(")");
  if (open < 0 || close < open) return [];
  return header
    .slice(open + 1, close)
    .split(",")
    .map((p) => p.split(/[:=]/)[0].trim())
    .filter(Boolean);
}

function annotated(header) {
  const open = header.indexOf("(");
  const close = header.lastIndexOf(")");
  if (open < 0 || close < open) return true;
  const inner = header.slice(open + 1, close).trim();
  if (!inner) return true;
  return inner.split(",").every((p) => p.includes(":"));
}

// One function's shape: loop depth, arithmetic kind, viper blockers.
function signals(fn) {
  const s = {
    maxDepth: 0, intOps: 0, floatOps: 0, index: 0,
    io: [], blockers: [], transcendental: [], globals: [],
    firstFloatLine: null, firstFloatText: null,
    names: new Set(params(fn.header)), assigned: new Set(), buffers: new Set(),
  };
  const baseIndent = fn.body.length
    ? Math.min(...fn.body.filter((l) => l.trim()).map(indentOf))
    : 0;

  // pass 1: names bound in the body
  for (const raw of fn.body) {
    const l = strip(raw);
    // any assignment, including tuple targets: a, b = 1, 2
    const eq = /^([^=<>!]+?)\s*(?:[-+*/%|&^]|<<|>>)?=(?!=)/.exec(l);
    if (eq && !/^\s*(if|elif|while|return|assert|del|print)\b/.test(l)) {
      for (const n of eq[1].match(/[A-Za-z_]\w*/g) || []) {
        if (!KEYWORDS.has(n)) { s.names.add(n); s.assigned.add(n); }
      }
    }
    // imports inside the body bind a name, and an I/O module is I/O
    const imp = /^\s*import\s+([A-Za-z_][\w.]*)|^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/.exec(l);
    if (imp) {
      if (imp[1]) {
        const root = imp[1].split(".")[0];
        s.names.add(root);
        if (IO_ROOTS.has(root) || root.startsWith("adafruit_")) s.io.push(root);
      } else {
        const root = imp[2].split(".")[0];
        if (IO_ROOTS.has(root) || root.startsWith("adafruit_")) s.io.push(root);
        for (const n of imp[3].split(",")) {
          const t = n.split(" as ").pop().trim();
          if (t) s.names.add(t);
        }
      }
    }
    const f = /^\s*for\s+([A-Za-z_][\w,\s]*)\s+in\s/.exec(l);
    if (f) f[1].split(",").forEach((n) => { const t = n.trim(); if (t) { s.names.add(t); s.assigned.add(t); } });
    const w = /^\s*with\s+.*\sas\s+([A-Za-z_]\w*)/.exec(l);
    if (w) { s.names.add(w[1]); s.assigned.add(w[1]); }
    const b = /([A-Za-z_]\w*)\s*=\s*(bytearray|bytes|array|memoryview)\s*\(/.exec(l);
    if (b) s.buffers.add(b[1]);
  }

  // pass 2: shape
  const stack = [];
  for (let k = 0; k < fn.body.length; k++) {
    const raw = fn.body[k];
    const lineNo = fn.headEnd + 1 + k;
    const l = strip(raw);
    if (!l.trim()) continue;
    const ind = indentOf(raw);
    while (stack.length && ind <= stack[stack.length - 1]) stack.pop();
    const depth = stack.length;

    if (/^\s*(for|while)\b/.test(l)) {
      stack.push(ind);
      s.maxDepth = Math.max(s.maxDepth, stack.length);
    }

    if (/^\s*global\b/.test(l)) {
      l.replace(/^\s*global\s+/, "").split(",").forEach((n) => {
        const t = n.trim();
        if (t) s.globals.push(t);
      });
    }
    if (/^\s*try\b|^\s*except\b/.test(l)) s.blockers.push("try/except");
    if (/\byield\b/.test(l)) s.blockers.push("generator");
    if (/\bf["']/.test(raw) && !/#/.test(raw.split(/f["']/)[0])) s.blockers.push("f-string");
    if (/\*\*/.test(l)) s.blockers.push("** operator");

    // float signals
    const floatLit = /(?<![\w.])\d+\.\d*(?![\w.])|(?<![\w.])\.\d+/.exec(l);
    if (floatLit) {
      s.floatOps++;
      if (s.firstFloatLine === null) { s.firstFloatLine = lineNo; s.firstFloatText = raw.trim(); }
    }
    const trueDiv = /[^\/]\/(?!\/)/.exec(l.replace(/\/\//g, "@@"));
    if (/(^|[^\/])\/([^\/]|$)/.test(l.replace(/\/\//g, "@@"))) {
      s.floatOps++;
      if (s.firstFloatLine === null) { s.firstFloatLine = lineNo; s.firstFloatText = raw.trim(); }
    }
    if (/\bmath\.\w+/.test(l)) {
      s.floatOps++;
      const t = /\bmath\.(\w+)/.exec(l);
      if (/^(sin|cos|tan|asin|acos|atan|atan2|exp|log|log2|log10|sqrt|pow|hypot|degrees|radians)$/.test(t[1])) {
        s.transcendental.push("math." + t[1]);
      }
      if (s.firstFloatLine === null) { s.firstFloatLine = lineNo; s.firstFloatText = raw.trim(); }
    }
    if (/\bfloat\s*\(/.test(l)) {
      s.floatOps++;
      if (s.firstFloatLine === null) { s.firstFloatLine = lineNo; s.firstFloatText = raw.trim(); }
    }

    // int ops
    const ops = l.match(/<<|>>|[+\-*%&|^]|\/\//g);
    if (ops) s.intOps += ops.length;

    // buffer indexing on a parameter or local buffer
    const idx = l.match(/([A-Za-z_]\w*)\s*\[/g);
    if (idx) {
      for (const raw2 of idx) {
        const n = raw2.replace(/\s*\[$/, "");
        if (s.names.has(n)) s.index++;
      }
    }

    // calls
    const calls = l.match(/([A-Za-z_][\w.]*)\s*\(/g) || [];
    for (const c of calls) {
      const name = c.replace(/\s*\($/, "");
      if (KEYWORDS.has(name)) continue;
      const root = name.split(".")[0];
      const leaf = name.split(".").pop();
      if (IO_ROOTS.has(root) || root.startsWith("adafruit_")) s.io.push(root);
      else if (name === "time.sleep" || name === "time.monotonic" || name === "print") s.io.push(name);
      else if (root === "math") { /* counted above */ }
      else if (name === "float") { /* counted above */ }
      else if (STR_METHODS.has(leaf)) s.blockers.push("string work");
      else if (GROW.has(leaf) && depth) s.blockers.push(`${leaf}() grows a container in the loop`);
      else if (!SAFE_CALLS.has(name) && !BUFFERS.has(name) && name !== fn.name) {
        s.blockers.push(`calls ${name}()`);
      }
    }

    // object attribute inside a loop
    if (depth) {
      const attrs = l.match(/\b([A-Za-z_]\w*)\.(\w+)/g) || [];
      for (const a of attrs) {
        const root = a.split(".")[0];
        if (root === "self" || (s.names.has(root) && !IO_ROOTS.has(root))) {
          s.blockers.push(`object attribute ${a}`);
        }
      }
      if (/[\[{]\s*[^\]}]*\s*for\s+\w+\s+in\b/.test(l) || /(?<![\w\]])\[[^\]]*\]/.test(l)) {
        if (/=\s*[\[{]/.test(l)) s.blockers.push("allocates in the loop");
      }
    }
  }

  // free names: anything not a param, local, builtin, or a dotted root
  s.free = [];
  const seen = new Set();
  for (const raw of fn.body) {
    const l = strip(raw);
    const words = l.match(/[A-Za-z_]\w*/g) || [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (KEYWORDS.has(w) || BUILTINS.has(w) || s.names.has(w) || seen.has(w)) continue;
      // skip attribute tails (x.attr) and keyword arguments
      const at = l.indexOf(w);
      if (at > 0 && l[at - 1] === ".") continue;
      seen.add(w);
      s.free.push(w);
    }
  }
  return s;
}

function uniq(a) { return [...new Set(a)]; }

function speedNote(march) {
  const m = MEASURED[march];
  if (!m) return march ? `no measurement for ${march} yet` : null;
  return `similar loops ran ${m.x}x on ${m.board}`;
}

// One row per top-level function, in file order.
export function analyze(text, march) {
  const fns = findFunctions(text);
  return fns.map((fn) => {
    const s = signals(fn);
    const r = { name: fn.name, line: fn.defLine, endLine: fn.endLine, fn };

    // Not movable beats everything: the split cannot even lift it.
    const nonTurbo = fn.decorators.filter((d) => !/^@turbo(\.|$|\()/.test(d));
    if (s.globals.length) {
      return { ...r, verdict: "bad", label: "Not movable", ticked: false,
        why: `uses global ${s.globals[0]}; move it into a parameter first` };
    }
    if (nonTurbo.length) {
      return { ...r, verdict: "bad", label: "Not movable", ticked: false,
        why: `decorated by ${nonTurbo[0]}; the split cannot carry that` };
    }
    if (s.free.length) {
      return { ...r, verdict: "bad", label: "Not movable", ticked: false,
        why: `reads ${s.free[0]} from the module; move it into a parameter first` };
    }

    if (s.maxDepth === 0) {
      return { ...r, verdict: "neutral", label: "Skip", ticked: false,
        why: "no loop. nothing to speed up" };
    }
    if (s.io.length) {
      const what = uniq(s.io)[0];
      return { ...r, verdict: "neutral", label: "Skip", ticked: false,
        why: `waits on ${what}. nothing here is CPU time` };
    }
    if (s.floatOps) {
      const where = s.firstFloatLine
        ? `line ${s.firstFloatLine}, <code>${escapeHtml(clip(s.firstFloatText))}</code> is a float`
        : "a float in the loop";
      return { ...r, verdict: "bad", label: "Rewrite", ticked: false, floatLine: s.firstFloatLine,
        why: `${where}. scale to integers first.`, how: true };
    }
    const blockers = uniq(s.blockers);
    if (blockers.length) {
      return { ...r, verdict: "bad", label: "Rewrite", ticked: false,
        why: `${blockers[0]}. viper cannot take that` };
    }
    if (s.intOps === 0) {
      return { ...r, verdict: "neutral", label: "Skip", ticked: false,
        why: "loop does no arithmetic" };
    }

    const note = speedNote(march);
    const buf = s.index ? "integer loop over a buffer, self-contained" : "integer loop, self-contained";
    if (!annotated(fn.header)) {
      // v0 shows the chip and treats it as Rewrite (turbo-web.md section 4).
      return { ...r, verdict: "warn", label: "Annotate", ticked: false,
        why: `shape is right. add <code>out: ptr8, n: int</code> to the parameters, then tick it` };
    }
    return { ...r, verdict: "ok", label: "Ready", ticked: true,
      why: note ? `${buf}. ${note}` : buf };
  });
}

function clip(s) {
  if (!s) return "";
  return s.length > 34 ? s.slice(0, 31) + "..." : s;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
