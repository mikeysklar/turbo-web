// Headless checks for the pure logic: verdicts, split, stub compiler.
//   node tools/test.mjs
import fs from "node:fs";
import path from "node:path";
import { analyze } from "../js/analyze.js";
import { split } from "../js/split.js";
import { parseProbe, parseBootOut, decodeMpy } from "../js/probe.js";

const ROOT = path.resolve(import.meta.dirname, "..");
let fails = 0;
const ok = (cond, what) => {
  console.log(`${cond ? "  ok  " : "FAIL  "}${what}`);
  if (!cond) fails++;
};

// --- probe -----------------------------------------------------------
for (const [mpy, march, loader] of [
  [0x0306, null, false], [0x1306, "armv6m", true], [0x1f06, "armv7emsp", true],
  [0x2b06, "xtensawin", true], [0x2f06, "rv32imc", true],
]) {
  const d = decodeMpy(mpy);
  ok(d.march === march && d.loader === loader && d.mpyVersion === 6 && d.mpySub === 3,
     `_mpy 0x${mpy.toString(16).padStart(4, "0")} -> ${march || "no native loader"}`);
}
const p = parseProbe(
  "11014|10.3.0 on 2026-08-31|Metro ESP32-S3 with ESP32S3|adafruit_metro_esp32s3");
ok(p.march === "xtensawin" && p.cpVersion === "10.3.0" &&
   p.boardId === "adafruit_metro_esp32s3", "probe line parses");
const bo = parseBootOut(
  "Adafruit CircuitPython 10.3.0 on 2026-08-31; Metro ESP32-S3 with ESP32S3\n" +
  "Board ID:adafruit_metro_esp32s3\n");
ok(bo.cpVersion === "10.3.0" && bo.boardId === "adafruit_metro_esp32s3",
   "boot_out.txt parses");

// --- verdicts --------------------------------------------------------
const example = fs.readFileSync(path.join(ROOT, "examples/mandelbrot.py"), "utf8");
const rows = analyze(example, "xtensawin");
const by = Object.fromEntries(rows.map((r) => [r.name, r]));
ok(by.mandel_row.label === "Ready" && by.mandel_row.ticked, "mandel_row is Ready and pre-ticked");
ok(/26\.2x/.test(by.mandel_row.why), "Ready quotes the board's measured number");
ok(by.blend.label === "Rewrite" && by.blend.floatLine === 27, "blend is Rewrite at line 27");
ok(by.update_display.label === "Skip", "update_display is Skip, it waits on displayio");
ok(by.run.label === "Not movable", "run is Not movable, it calls another module function");

const noNum = analyze(example, "armv7m");
ok(!/x on/.test(noNum.find((r) => r.name === "mandel_row").why),
   "no number is invented for an arch with no measurement");

ok(analyze("def f(a):\n    return a + 1\n", "armv6m")[0].label === "Skip",
   "no loop -> Skip");
ok(analyze("PAL = 3\ndef f(n):\n    for i in range(n):\n        n += PAL\n", "armv6m")[0]
     .label === "Not movable", "reads a module global -> Not movable");
ok(analyze("def f(n: int):\n    for i in range(n):\n        n += 1\n", "armv6m")[0]
     .label === "Ready", "annotated integer loop -> Ready");
ok(analyze("def f(n):\n    for i in range(n):\n        n += 1\n", "armv6m")[0]
     .label === "Annotate", "unannotated integer loop -> Annotate");

// --- split -----------------------------------------------------------
const s = split(example, ["mandel_row"]);
ok(!/^def mandel_row/m.test(s.codePy), "the lifted def leaves code.py");
ok(/^from fast import mandel_row$/m.test(s.codePy), "code.py imports it back");
ok(/^import turbo$/m.test(s.codePy), "the shim import comes first");
ok(s.codePy.indexOf("import turbo") < s.codePy.indexOf("from fast import"),
   "import turbo precedes the module import");
ok(/@micropython\.viper/.test(s.fastPy) && !/@turbo/.test(s.fastPy),
   "what the compiler sees uses @micropython.viper");
ok(/@turbo\.viper/.test(s.srcPy) && /from turbo import turbo/.test(s.srcPy),
   "what lands in /src uses @turbo.viper so stock firmware still runs it");
ok(/_turbo_bench/.test(s.fastPy) && /_turbo_bench/.test(s.srcPy),
   "both forms carry the same bench harness");
ok(s.lineMap[4] === 6, "line 4 of the module maps back to line 6 of the original");

// --- stub compiler ---------------------------------------------------
globalThis.fetch = async (u) => {
  const f = path.join(ROOT, u);
  if (!fs.existsSync(f)) return { ok: false, status: 404 };
  const b = fs.readFileSync(f);
  return { ok: true, status: 200, text: async () => b.toString("utf8"),
           arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const { compile, STUB_REFUSAL } = await import("../js/compile.js");
for (const a of ["armv6m", "armv7emsp", "xtensawin", "rv32imc"]) {
  const r = await compile({ source: s.fastPy, march: a });
  const disk = fs.readFileSync(path.join(ROOT, `mpy/fast-${a}.mpy`));
  ok(r.ok && Buffer.compare(Buffer.from(r.bytes), disk) === 0,
     `${a}: the stub serves the native compiler's bytes (${disk.length} B)`);
  ok(disk[0] === 0x43 && (disk[2] >> 2) === { armv6m: 4, armv7emsp: 7, xtensawin: 10, rv32imc: 11 }[a],
     `${a}: the .mpy header carries the right arch id`);
}
const bad = await compile({ source: "@micropython.viper\ndef g(a: int):\n    return a\n", march: "xtensawin" });
ok(!bad.ok && bad.message === STUB_REFUSAL, "an unknown source is refused, not guessed at");

console.log(fails ? `\n${fails} failed` : "\nall good");
process.exit(fails ? 1 : 0);
