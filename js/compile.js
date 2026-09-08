// mpy-cross in the page. turbo-web.md 6.6.
//
//   compile({source, march, name}) ->
//     {ok:true,  bytes: Uint8Array}
//   | {ok:false, line: number|null, message: string, stderr: string}
//
// v0 is a stub: it serves pre-built .mpy files for the mandelbrot example,
// one per arch, compiled by the native mpy-cross from exactly what split.js
// emits. Anything else gets an honest refusal, not a wrong file.
//
// v1 replaces loadWasm() with the emscripten build and keeps this signature,
// so app.js does not change.

export const COMPILER = {
  kind: "stub",
  version: "10.3.0",
  mpy: "v6.3",
  label: "stub (pre-built mandelbrot only)",
};

export const STUB_REFUSAL =
  "compiler not in the page yet; download the files and run turbo build";

// Compare on structure, not bytes: comments and blank lines do not change
// what mpy-cross emits from this source.
function fingerprint(src) {
  return src
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trimEnd())
    .filter((l) => l.trim())
    .join("\n");
}

let exampleFp = null;
async function exampleFingerprint() {
  if (exampleFp !== null) return exampleFp;
  try {
    const r = await fetch("examples/mandelbrot-fast.py");
    exampleFp = r.ok ? fingerprint(await r.text()) : "";
  } catch (e) {
    exampleFp = "";
  }
  return exampleFp;
}

// Last stderr line and the "File ..., line N" the compiler reports (3.5).
export function parseStderr(stderr) {
  const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
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

export async function compile({ source, march }) {
  if (!march) {
    return { ok: false, line: null, stderr: "",
             message: "no architecture known for this board" };
  }
  const want = fingerprint(source);
  const have = await exampleFingerprint();
  if (have && want === have) {
    const r = await fetch(`mpy/fast-${march}.mpy`);
    if (r.ok) {
      return { ok: true, bytes: new Uint8Array(await r.arrayBuffer()) };
    }
    return { ok: false, line: null, stderr: "",
             message: `no pre-built module for ${march}` };
  }
  return { ok: false, line: null, stderr: "", message: STUB_REFUSAL };
}
