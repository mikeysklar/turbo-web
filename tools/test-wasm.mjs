// The acceptance test for the in-page compiler, turbo-web.md 6.2: its output
// must be byte-identical to the native mpy-cross for every architecture.
//
//   node tools/test-wasm.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARCHES = ["armv6m", "armv7m", "armv7em", "armv7emsp", "armv7emdp",
                "xtensa", "xtensawin", "rv32imc"];
let fails = 0;
const ok = (c, what) => { console.log(`${c ? "  ok  " : "FAIL  "}${what}`); if (!c) fails++; };

globalThis.fetch = async (u) => {
  const f = path.join(ROOT, u);
  if (!fs.existsSync(f)) return { ok: false, status: 404 };
  const b = fs.readFileSync(f);
  return { ok: true, status: 200, text: async () => b.toString("utf8"),
           arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

const { compile, versionRefusal, parseStderr, hintFor, COMPILER } =
  await import("../js/compile.js");
const src = fs.readFileSync(path.join(ROOT, "examples/mandelbrot-fast.py"), "utf8");

const t0 = Date.now();
for (const march of ARCHES) {
  const r = await compile({ source: src, march, name: "fast" });
  const oracle = fs.readFileSync(path.join(ROOT, `mpy/fast-${march}.mpy`));
  ok(r.ok && Buffer.compare(Buffer.from(r.bytes), oracle) === 0,
     `${march}: identical to the native compiler (${oracle.length} B)`);
}
console.log(`      ${ARCHES.length} architectures in ${Date.now() - t0} ms`);

// The name must not leak an absolute path into the .mpy: that changes the
// bytes and shows up in tracebacks on the board as "/fast.py".
const named = await compile({ source: src, march: "armv6m", name: "fast" });
ok(named.ok && named.bytes.length ===
   fs.readFileSync(path.join(ROOT, "mpy/fast-armv6m.mpy")).length,
   "the module name does not change the byte count");

// error paths
const bad = await compile({
  source: "@micropython.viper\ndef f(a: int):\n    return a * 0.5\n",
  march: "xtensawin", name: "fast" });
ok(!bad.ok, "a float in a viper function is refused");
ok(bad.line === 2, `the failing line comes back (got ${bad.line})`);
ok(/ViperTypeError/.test(bad.message), `the compiler's own words come back: ${bad.message}`);
ok(hintFor("ViperTypeError: can't do binary op between 'int' and 'object'") !== null,
   "the hint table matches the documented message");

const syntax = await compile({ source: "def f(\n", march: "armv6m", name: "fast" });
ok(!syntax.ok && /SyntaxError/.test(syntax.message),
   `a syntax error is reported, not swallowed: ${syntax.message}`);

ok((await compile({ source: src, march: null })).ok === false,
   "no arch, no compile");

// version guard
ok(versionRefusal({ mpyVersion: 6, mpySub: 3, cpVersion: "10.3.0" }) === null,
   "a matching board is allowed");
const refusal = versionRefusal({ mpyVersion: 6, mpySub: 1, cpVersion: "9.2.8" });
ok(refusal !== null && /9\.2\.8/.test(refusal) && /turbo build/.test(refusal),
   "a board on a different .mpy format is refused by name");
ok(versionRefusal(null) === null, "an unknown board does not trip the guard");

ok(COMPILER.kind === "wasm" && COMPILER.version === "10.3.0",
   "the page reports which compiler it carries");

console.log(fails ? `\n${fails} failed` : "\nall good");
process.exit(fails ? 1 : 0);
