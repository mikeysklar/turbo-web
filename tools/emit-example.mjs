// Write what split.js produces for the example, so tools/build-mpy.sh
// compiles exactly what the page will hand the compiler.
//   node tools/emit-example.mjs <code.py> <fast.py out> <src.py out>
import fs from "node:fs";
import { analyze } from "../js/analyze.js";
import { split } from "../js/split.js";

const [, , src, fastOut, srcOut] = process.argv;
const text = fs.readFileSync(src, "utf8");
const ticked = analyze(text, "xtensawin").filter((r) => r.ticked).map((r) => r.name);
if (!ticked.length) throw new Error("nothing came back Ready");
const s = split(text, ticked);
fs.writeFileSync(fastOut, s.fastPy);
fs.writeFileSync(srcOut, s.srcPy);
console.log(`ticked ${ticked.join(", ")} -> ${fastOut}, ${srcOut}`);
