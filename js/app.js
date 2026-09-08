// turbo for CircuitPython. State machine and panel wiring, turbo-web.md 5.1.

import { Board, cleanErr, isReadOnly } from "./serial.js";
import { PROBE_CODE, parseProbe, parseBootOut, mpyLabel } from "./probe.js";
import { analyze, escapeHtml, MEASURED } from "./analyze.js";
import { split, diffView, mapLine } from "./split.js";
import { compile, parseStderr, hintFor, COMPILER, STUB_REFUSAL } from "./compile.js";
import { BOARDS, archForBoard, firmwareFor, installButton, loadInstaller,
         firmwarePresent, pickerBoards, TURBO_VERSION } from "./firmware.js";

const $ = (id) => document.getElementById(id);

const S = {
  conn: null,
  board: null,          // {machine, boardId, cpVersion, mpy, march, loader}
  offline: false,       // no-serial path
  file: null,           // {name, text}
  functions: [],
  plan: null,           // {codePy, fastPy, srcPy, moduleName, lineMap}
  compiled: null,       // {bytes, size, march}
  result: null,         // {before, after}
  busy: false,
};

// ------------------------------------------------------------- steps

function stepState() {
  const connect = !!S.board;
  const firmware = connect && (S.board.loader || S.offline);
  const code = !!S.file && S.functions.some((f) => f.ticked);
  const result = !!S.result;
  return { connect, firmware, code, result };
}

function render() {
  const st = stepState();
  const order = ["connect", "firmware", "code", "result"];
  const first = order.find((k) => !st[k]);
  for (const el of $("steps").children) {
    const k = el.dataset.step;
    el.className = st[k] ? "done" : k === first ? "on" : "";
  }
  $("p-board").dataset.state = st.connect ? "done" : "on";
  $("p-firmware").dataset.state = S.board ? "on" : "pending";
  $("p-code").dataset.state = S.board ? "on" : "pending";
  $("p-changes").dataset.state = st.code ? "on" : "pending";
  $("p-result").dataset.state = S.result ? "on" : "pending";
  renderChanges();
}

function status(id, text, cls) {
  const el = $(id);
  el.textContent = text || "";
  el.className = "status" + (cls ? " " + cls : "");
}

function chip(id, cls, text) {
  const el = $(id);
  el.className = "chip " + cls;
  el.textContent = text;
}

// ------------------------------------------------------------- board

async function connect() {
  if (!Board.supported()) {
    status("board-status",
      "This browser has no WebSerial. Use Chrome or Edge on a desktop, or pick your board below.", "bad");
    $("noserial").hidden = false;
    return;
  }
  let b;
  try {
    b = await Board.request();
  } catch (e) {
    status("board-status", "No port chosen.");
    return;
  }
  status("board-status", "Opening the port...");
  try {
    await b.open();
    b.onLost = () => disconnect(true);
    status("board-status", "Stopping code.py and reading the board...");
    const { out, err } = await b.exec(PROBE_CODE, 8000);
    if (err.trim()) throw new Error(cleanErr(err));
    const info = parseProbe(out);
    S.conn = b;
    S.offline = false;
    S.board = info;
    showBoard();
    await showFirmware();
    status("board-status2", "");
    render();
  } catch (e) {
    status("board-status", `Could not read the board: ${e.message}`, "bad");
    try { await b.close(); } catch (_) {}
  }
}

async function disconnect(lost) {
  if (S.conn) { try { await S.conn.close(); } catch (e) {} }
  S.conn = null;
  S.board = null;
  S.offline = false;
  S.compiled = null;
  S.result = null;
  $("board-info").hidden = true;
  $("board-idle").hidden = false;
  chip("board-chip", "neutral", "Not connected");
  status("board-status", lost ? "The board went away." : "");
  chip("fw-chip", "neutral", "Waiting for a board");
  $("fw-slot").textContent = "";
  status("fw-status", "");
  resetResult();
  if (S.file) reanalyze();
  render();
}

function showBoard() {
  const b = S.board;
  $("board-idle").hidden = true;
  $("board-info").hidden = false;
  chip("board-chip", S.offline ? "warn" : "ok", S.offline ? "Picked, not connected" : "Connected");
  $("r-board").innerHTML =
    `${escapeHtml(b.machine || BOARDS[b.boardId]?.name || b.boardId)} ` +
    `<span class="mono" style="color:var(--muted)">${escapeHtml(b.boardId)}</span>`;
  $("r-version").textContent = b.cpVersion || "unknown";
  if (S.offline) {
    $("r-arch").innerHTML =
      `${escapeHtml(b.march || "unknown")} <span class="chip warn">assumes turbo firmware</span>`;
  } else if (b.loader) {
    $("r-arch").innerHTML =
      `${escapeHtml(b.march)} <span class="chip ok">turbo firmware present</span> ` +
      `<span class="mono" style="color:var(--muted);font-size:12px">${mpyLabel(b)}</span>`;
  } else {
    $("r-arch").innerHTML = `<span class="chip bad">no native loader</span>`;
  }
  $("btn-disconnect").textContent = S.offline ? "Pick a different board" : "Disconnect";
}

// ---------------------------------------------------------- firmware

async function showFirmware() {
  const b = S.board;
  const slot = $("fw-slot");
  slot.textContent = "";
  const fw = firmwareFor(b.boardId);

  if (!fw) {
    chip("fw-chip", "neutral", "not published yet");
    status("fw-status", `No turbo firmware published for ${b.boardId} yet.`);
    return;
  }
  // Without a serial connection the page cannot read _mpy, so it must not
  // claim the loader is there or missing.
  const fwChip = () => S.offline
    ? ["neutral", "cannot tell without serial"]
    : b.loader ? ["neutral", `turbo ${TURBO_VERSION} already on the board`] : ["acc", "needed"];

  const present = await firmwarePresent(b.boardId);
  if (!present) {
    chip("fw-chip", ...fwChip());
    status("fw-status",
      `The firmware files are not beside this page yet. Run tools/fetch-firmware.sh, ` +
      `or flash ${b.boardId} yourself from the fork's cp-${TURBO_VERSION} release.`, "bad");
    return;
  }

  try {
    await loadInstaller();
  } catch (e) {
    status("fw-status", e.message, "bad");
    return;
  }
  const btn = installButton(b.boardId);
  chip("fw-chip", ...fwChip());
  if (b.loader && !S.offline) {
    btn.className = "btn always";
    btn.textContent = "Re-flash turbo firmware";
  }
  const row = document.createElement("div");
  row.className = "btn-row";
  row.style.marginTop = "2px";
  row.appendChild(btn);
  slot.appendChild(row);
  status("fw-status", "The port drops while the board is flashing. Reconnect afterwards.");
}

// ------------------------------------------------------- no-serial path

function fillBoardPicker() {
  const sel = $("board-select");
  sel.innerHTML = '<option value="">Choose a board...</option>';
  const all = pickerBoards();
  const withFw = Object.entries(all).filter(([, b]) => b.firmware);
  const without = Object.entries(all).filter(([, b]) => !b.firmware);
  const group = (label, rows) => {
    if (!rows.length) return;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const [id, b] of rows.sort((x, y) => x[1].name.localeCompare(y[1].name))) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = `${b.name}  (${b.march})`;
      g.appendChild(o);
    }
    sel.appendChild(g);
  };
  group("turbo firmware published", withFw);
  group("arch known, no turbo build yet", without);
}

function pickBoard(id) {
  if (!id) return;
  const b = pickerBoards()[id];
  S.conn = null;
  S.offline = true;
  S.board = {
    boardId: id, machine: b.name, cpVersion: TURBO_VERSION,
    march: archForBoard(id), loader: true, mpy: 0, mpyVersion: 6, mpySub: 3,
  };
  showBoard();
  showFirmware();
  if (S.file) reanalyze();
  render();
}

// -------------------------------------------------------------- code

function loadCode(name, text) {
  S.file = { name, text };
  S.compiled = null;
  S.result = null;
  resetResult();
  reanalyze();
  render();
}

function reanalyze() {
  if (!S.file) return;
  const march = S.board ? S.board.march : null;
  const prev = new Map(S.functions.map((f) => [f.name, f.ticked]));
  S.functions = analyze(S.file.text, march);
  for (const f of S.functions) {
    if (prev.has(f.name)) f.ticked = prev.get(f.name) && f.verdict === "ok";
  }
  renderCode();
}

function renderCode() {
  const lines = S.file.text.split(/\r?\n/).length;
  const n = S.functions.length;
  const ready = S.functions.filter((f) => f.verdict === "ok").length;
  $("drop-text").innerHTML =
    `<span class="file">${escapeHtml(S.file.name)}</span> &nbsp;&middot;&nbsp; ${lines} lines ` +
    `&nbsp;&middot;&nbsp; ${n} function${n === 1 ? "" : "s"} &nbsp;&middot;&nbsp; ` +
    `<button class="linkish" id="btn-example">try the mandelbrot example</button>`;
  $("btn-example").onclick = loadExample;

  if (!n) {
    chip("code-chip", "neutral", "no functions");
    $("verdicts").innerHTML = "";
    status("code-status", "No top-level functions found. Put the hot loop in a def.");
    return;
  }
  chip("code-chip", ready ? "acc" : "neutral", `${ready} of ${n} functions worth it`);
  status("code-status", ready ? "tick what to make fast" : "");

  const v = $("verdicts");
  v.innerHTML = "";
  for (const f of S.functions) {
    const row = document.createElement("div");
    row.className = "v";
    const canTick = f.verdict === "ok";
    const how = f.how
      ? ' <a href="https://github.com/mikeysklar/turbo/blob/main/docs/turbo-conversion.md" target="_blank" rel="noopener">how</a>'
      : "";
    row.innerHTML =
      `<span class="fn"><input type="checkbox" class="cb" ${f.ticked ? "checked" : ""} ` +
      `${canTick ? "" : "disabled"} aria-label="compile ${escapeHtml(f.name)}">` +
      `${escapeHtml(f.name)}</span>` +
      `<span><span class="chip ${f.verdict}">${f.label}</span></span>` +
      `<span class="why">${f.why}${how}</span>`;
    row.querySelector("input").addEventListener("change", (e) => {
      f.ticked = e.target.checked;
      S.compiled = null;
      S.result = null;
      resetResult();
      render();
    });
    v.appendChild(row);
  }
}

async function loadExample() {
  try {
    const r = await fetch("examples/mandelbrot.py");
    if (!r.ok) throw new Error(`${r.status}`);
    loadCode("mandelbrot.py", await r.text());
  } catch (e) {
    status("code-status", `Could not load the example: ${e.message}`, "bad");
  }
}

// ----------------------------------------------------- what changes

function renderChanges() {
  const ticked = S.functions.filter((f) => f.ticked).map((f) => f.name);
  const left = $("chg-left"), mpyEl = $("chg-mpy"), srcEl = $("chg-src");

  if (!ticked.length) {
    S.plan = null;
    chip("chg-chip", "neutral", "nothing yet");
    $("chg-h-left").textContent = "unchanged";
    left.innerHTML = '<span class="dim">tick a function above</span>';
    $("chg-h-mpy").textContent = "not compiled yet";
    mpyEl.innerHTML = '<span class="dim">machine code, compiled in the browser</span>';
    $("chg-h-src").textContent = "new";
    srcEl.innerHTML = '<span class="dim">source fallback, runs on stock firmware</span>';
    $("btn-go").disabled = true;
    $("btn-download").disabled = true;
    return;
  }

  try {
    S.plan = split(S.file.text, ticked);
  } catch (e) {
    chip("chg-chip", "bad", "cannot split");
    status("chg-status", e.message, "bad");
    return;
  }

  chip("chg-chip", "neutral", "3 files");
  $("chg-h-left").textContent = "edited";
  left.innerHTML = diffView(S.file.text, ticked)
    .map((d) => d.kind === "same"
      ? escapeHtml(d.text)
      : `<span class="${d.kind}">${escapeHtml(d.text)}</span>`)
    .join("\n");

  const march = S.board ? S.board.march : null;
  $("chg-h-mpy").textContent = S.compiled
    ? `new, ${S.compiled.size} B`
    : "new, not compiled yet";
  document.querySelector('#p-changes .split .col:last-child .h').firstChild.textContent =
    march ? `lib/turbo/${march}/${S.plan.moduleName}.mpy ` : `lib/turbo/<arch>/${S.plan.moduleName}.mpy `;
  mpyEl.innerHTML = S.compiled
    ? `<span class="dim">machine code for ${escapeHtml(S.compiled.march)}\ncompiled in the browser</span>`
    : `<span class="dim">machine code${march ? " for " + escapeHtml(march) : ""}\nnot compiled yet</span>`;

  $("chg-h-src").textContent = "new";
  srcEl.textContent = S.plan.srcPy;

  $("btn-go").disabled = S.busy;
  $("btn-download").disabled = S.busy;
  $("btn-go").textContent = S.conn
    ? "Compile, install to board, measure"
    : "Compile and download";
}

// --------------------------------------------------------- the run

function setBusy(on, label) {
  S.busy = on;
  $("btn-go").disabled = on;
  $("btn-download").disabled = on;
  if (label) $("btn-go").textContent = label;
  else renderChanges();
}

async function doCompile() {
  const march = S.board ? S.board.march : null;
  const r = await compile({ source: S.plan.fastPy, march, name: S.plan.moduleName });
  if (r.ok) {
    S.compiled = { bytes: r.bytes, size: r.bytes.length, march };
    return true;
  }
  const { line, message } = r.stderr ? parseStderr(r.stderr) : r;
  const orig = mapLine(S.plan.lineMap, line);
  const hint = hintFor(message || "");
  const where = orig ? `line ${orig}: ` : "";
  status("chg-status", `${where}${message}${hint ? " — " + hint : ""}`,
         message === STUB_REFUSAL ? "" : "bad");
  S.compiled = null;
  return false;
}

async function goPressed() {
  status("chg-status", "");
  setBusy(true, "Compiling...");
  const ok = await doCompile();
  if (!ok) {
    setBusy(false);
    renderChanges();
    if (!S.compiled) await downloadFiles(true);
    return;
  }
  renderChanges();

  if (!S.conn) {
    setBusy(false);
    await downloadFiles();
    return;
  }

  try {
    setBusy(true, "Installing...");
    await install();
    if (!S.board.loader) {
      status("chg-status",
        "Installed. This firmware has no native loader, so the compiled module cannot run here " +
        "and there is nothing to measure. Flash turbo firmware, then press this again.", "bad");
    } else {
      setBusy(true, "Measuring...");
      await measure();
      status("chg-status", "installed and measured. the board reloads on its own.", "ok");
    }
  } catch (e) {
    const msg = e.message || String(e);
    if (isReadOnly(msg)) {
      status("chg-status",
        "The board has CIRCUITPY mounted read-only from its own side, so the page cannot write to it. " +
        "Download the files and drag them onto the drive instead.", "bad");
      await downloadFiles();
    } else {
      status("chg-status", msg, "bad");
    }
  }
  setBusy(false);
  render();
}

async function install() {
  const b = S.conn, p = S.plan, march = S.board.march;
  const enc = new TextEncoder();

  if (!(await b.exists("/lib/turbo.py"))) {
    const shim = await (await fetch("assets/turbo.py")).text();
    await b.writeFile("/lib/turbo.py", enc.encode(shim));
  }
  await b.writeFile(`/src/${p.moduleName}.py`, enc.encode(p.srcPy));
  await b.writeFile(`/lib/turbo/${march}/${p.moduleName}.mpy`, S.compiled.bytes,
    (done, total) => setBusy(true, `Installing... ${Math.round((done / total) * 100)}%`));
  await b.writeFile("/code.py", enc.encode(p.codePy));
}

// Time _turbo_bench() twice: once forced to import from /src, once from the
// arch directory. turbo-web.md 3.2.
const BENCH = (path, mod) => `
import sys, time, gc
sys.path[:] = [p for p in sys.path if not p.startswith("/src") and not p.startswith("/lib/turbo")]
sys.path.insert(0, ${JSON.stringify(path)})
if ${JSON.stringify(mod)} in sys.modules:
    del sys.modules[${JSON.stringify(mod)}]
gc.collect()
import ${mod} as _m
t0 = time.monotonic_ns()
_v = _m._turbo_bench()
print((time.monotonic_ns() - t0) // 1000000)
`;

async function measure() {
  const b = S.conn, mod = S.plan.moduleName, march = S.board.march;
  const before = await benchOne(b, "/src", mod);
  const after = await benchOne(b, `/lib/turbo/${march}`, mod);
  S.result = { before, after };
  renderResult(true);
}

async function benchOne(b, path, mod) {
  const { out, err } = await b.exec(BENCH(path, mod), 600000);
  if (err.trim()) throw new Error(cleanErr(err));
  const ms = parseInt(out.trim().split(/\r?\n/).pop(), 10);
  if (Number.isNaN(ms)) throw new Error(`bench from ${path} printed ${JSON.stringify(out.trim())}`);
  return ms;
}

// -------------------------------------------------------------- result

function resetResult() {
  $("res-before").innerHTML = "&mdash;<small>ms</small>";
  $("res-after").innerHTML = "&mdash;<small>ms</small>";
  $("res-ratio").innerHTML = "&mdash;<small>x</small>";
  $("bar-before").style.width = "0%";
  $("bar-after").style.width = "0%";
  $("bar-before-v").textContent = "—";
  $("bar-after-v").textContent = "—";
  chip("res-chip", "neutral", "nothing measured yet");
  $("res-note").textContent =
    "The page runs the same work twice on the connected board, from source and from the compiled module.";
}

function renderResult(real) {
  if (!S.result) return;
  const { before, after } = S.result;
  const ratio = after > 0 ? before / after : 0;
  const fmt = (n) => n.toLocaleString("en-US");
  $("res-before").innerHTML = `${fmt(before)}<small>ms</small>`;
  $("res-after").innerHTML = `${fmt(after)}<small>ms</small>`;
  $("res-ratio").innerHTML = `${ratio.toFixed(1)}<small>x</small>`;
  $("bar-before").style.width = "100%";
  $("bar-after").style.width = `${Math.max(1, (after / before) * 100).toFixed(1)}%`;
  $("bar-before-v").textContent = `${fmt(before)} ms`;
  $("bar-after-v").textContent = `${fmt(after)} ms`;
  chip("res-chip", "ok", "measured on your board just now");
  const names = S.plan.lifted.map((l) => l.name).join(", ");
  $("res-note").textContent =
    `${names}, called 120 times, on the ${S.board.machine}. ` +
    `Bytecode from /src against the compiled module in /lib/turbo/${S.board.march}.`;
}

// ------------------------------------------------------------ download

async function downloadFiles(sourceOnly) {
  const p = S.plan;
  const march = S.board ? S.board.march : null;
  save("code.py", new TextEncoder().encode(p.codePy));
  save(`${p.moduleName}.py`, new TextEncoder().encode(p.srcPy));
  if (S.compiled) save(`${p.moduleName}.mpy`, S.compiled.bytes);
  const what = S.compiled
    ? `code.py -> /, ${p.moduleName}.py -> /src/, ${p.moduleName}.mpy -> /lib/turbo/${march}/`
    : `code.py -> /, ${p.moduleName}.py -> /src/. Then: turbo build --arch ${march || "<arch>"}`;
  status("chg-status", (sourceOnly ? STUB_REFUSAL + ". " : "") + "Downloaded. " + what);
}

function save(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// -------------------------------------------------------------- wiring

$("btn-connect").onclick = connect;
$("btn-disconnect").onclick = () => disconnect(false);
$("btn-noserial").onclick = () => {
  const el = $("noserial");
  el.hidden = !el.hidden;
};
$("board-select").onchange = (e) => pickBoard(e.target.value);
$("btn-bootout").onclick = () => $("bootout-file").click();
$("bootout-file").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const info = parseBootOut(await f.text());
  if (!info.boardId) {
    status("board-status", "That does not look like a boot_out.txt.", "bad");
    return;
  }
  S.offline = true;
  S.conn = null;
  S.board = { ...info, march: archForBoard(info.boardId), loader: true, mpy: 0 };
  if (!S.board.march) {
    status("board-status", `Unknown board ${info.boardId}; no arch for it yet.`, "bad");
    S.board = null;
    return;
  }
  showBoard();
  showFirmware();
  if (S.file) reanalyze();
  render();
};

$("btn-example").onclick = loadExample;
$("btn-browse").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  const f = e.target.files[0];
  if (f) loadCode(f.name, await f.text());
};
$("btn-paste").onclick = () => {
  $("paste").hidden = false;
  $("paste-row").hidden = false;
  $("paste").focus();
};
$("btn-cancelpaste").onclick = () => {
  $("paste").hidden = true;
  $("paste-row").hidden = true;
};
$("btn-usepaste").onclick = () => {
  const t = $("paste").value;
  if (!t.trim()) return;
  $("paste").hidden = true;
  $("paste-row").hidden = true;
  loadCode("pasted.py", t);
};

const drop = $("drop");
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (!f.name.endsWith(".py")) {
    status("code-status", "That is not a .py file.", "bad");
    return;
  }
  loadCode(f.name, await f.text());
});

$("btn-go").onclick = goPressed;
$("btn-download").onclick = () => downloadFiles();

fillBoardPicker();
$("footer-line").textContent =
  `compiler: ${COMPILER.label} · mpy ${COMPILER.mpy} · turbo firmware ${TURBO_VERSION}`;
if (!Board.supported()) {
  status("board-status",
    "This browser has no WebSerial. Chrome or Edge on a desktop connects to the board; " +
    "everything else works from the board picker.");
  $("noserial").hidden = false;
}
render();
