// mpy-cross in the page. turbo-web.md 6.2 and 6.6.
//
//   compile({source, march, name}) ->
//     {ok:true,  bytes: Uint8Array}
//   | {ok:false, line: number|null, message: string, stderr: string}
//
// This is the real compiler: CircuitPython's own mpy-cross, built at the
// 10.3.0 tag with emscripten. Verified byte-identical to the native binary
// for all eight architectures (tools/test-wasm.mjs).
//
// Each compile gets a fresh instance. The build links with EXIT_RUNTIME=1, so
// callMain() tears the runtime down on the way out and the module cannot be
// reused. Instantiating costs about 2 ms.

const VERSION = "10.3.0";
const WASM = `mpy-cross/${VERSION}/mpy-cross.mjs`;

export const COMPILER = {
  kind: "wasm",
  version: VERSION,
  mpy: "v6.3",
  mpyVersion: 6,
  mpySub: 3,
  label: `mpy-cross ${VERSION}`,
};

let factory = null;
async function load() {
  if (!factory) {
    const mod = await import(`./../${WASM}`);
    factory = mod.default;
  }
  return factory;
}

// Warm the module up so the first real compile is not also the download.
export function preload() {
  return load().catch(() => null);
}

// A board whose .mpy format differs cannot load anything this page produces.
// turbo-web.md 6.2. Returns null when the board is fine.
export function versionRefusal(board) {
  if (!board || !board.mpyVersion) return null;
  if (board.mpyVersion === COMPILER.mpyVersion && board.mpySub === COMPILER.mpySub) {
    return null;
  }
  return `This page carries mpy-cross ${VERSION}; your board runs ` +
         `${board.cpVersion || "a different version"}. Use turbo build on the command line.`;
}

// Last stderr line and the "File ..., line N" the compiler reports (3.5).
export function parseStderr(stderr) {
  const lines = stderr.replace(/\r/g, "").trim().split("\n").filter(Boolean);
  const message = lines.length ? lines[lines.length - 1] : "";
  let line = null;
  for (const l of lines) {
    const m = /File\s+"[^"]*",\s+line\s+(\d+)/.exec(l);
    if (m) line = parseInt(m[1], 10);
  }
  return { line, message };
}

// turbo-cli.md section 6: match the compiler's last line by prefix.
const HINTS = [
  ["ViperTypeError: can't do binary op between 'int' and 'object'",
   "a float reached a viper function; scale to integers"],
  ["ViperTypeError: local",
   "a value came from a Python object; declare the parameter type (out: ptr8, n: int) or convert with int()"],
  ["ViperTypeError: return expected",
   "the return type does not match; annotate the function or convert with int()"],
  ["SyntaxError: invalid micropython decorator",
   "this firmware has no emitter; the decorator must go through turbo build, not run from source"],
  ["ValueError: incompatible .mpy arch",
   "the .mpy is for a different arch"],
  ["ValueError: native code in .mpy unsupported",
   "stock firmware, no native loader"],
];

export function hintFor(message) {
  for (const [prefix, hint] of HINTS) {
    if (message.startsWith(prefix)) return hint;
  }
  return null;
}

// Emscripten's filesystem errors carry no .message, so String(e) is
// "[object Object]". Say something useful instead.
function describe(e) {
  if (!e) return "the compiler failed";
  if (e.message) return e.message;
  if (e.name) return e.name + (e.errno !== undefined ? ` (errno ${e.errno})` : "");
  return "the compiler failed";
}

export async function compile({ source, march, name }) {
  if (!march) {
    return { ok: false, line: null, stderr: "",
             message: "no architecture known for this board" };
  }
  const base = (name || "fast").replace(/[^\w.-]/g, "");
  // Relative paths only. An absolute path would be embedded in the .mpy and
  // show up in tracebacks on the board as "/fast.py".
  const py = `${base}.py`;
  const mpy = `${base}.mpy`;

  let create;
  try {
    create = await load();
  } catch (e) {
    return { ok: false, line: null, stderr: "",
             message: `could not load the compiler: ${e.message}` };
  }

  const errLines = [];
  let m;
  try {
    m = await create({ printErr: (l) => errLines.push(l), print: () => {} });
  } catch (e) {
    return { ok: false, line: null, stderr: "",
             message: `could not start the compiler: ${e.message}` };
  }

  let rc = 0;
  try {
    m.FS.writeFile(py, source);
    // Returns the exit code on a clean run; throws ExitStatus when the build
    // is linked with EXIT_RUNTIME and main calls exit().
    rc = m.callMain([`-march=${march}`, py, "-o", mpy]) ?? 0;
  } catch (e) {
    if (e && e.name === "ExitStatus") {
      rc = e.status;
    } else {
      return { ok: false, line: null, stderr: errLines.join("\n"),
               message: describe(e) };
    }
  }

  // Read the output only after the run, and never let a missing file mask the
  // compiler's own diagnosis of why it is missing.
  let bytes = null;
  if (rc === 0) {
    try { bytes = m.FS.readFile(mpy); } catch (_) { bytes = null; }
  }

  const stderr = errLines.join("\n");
  if (rc === 0 && bytes && bytes.length) {
    return { ok: true, bytes: new Uint8Array(bytes) };
  }
  const { line, message } = parseStderr(stderr);
  return { ok: false, line, stderr,
           message: message || `mpy-cross exited ${rc}` };
}
