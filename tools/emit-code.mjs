// Write the split's code.py and src/fast.py for a source file.
//   node tools/emit-code.mjs <code.py> <code.py out> <src/fast.py out>
import fs from "node:fs";
import { analyze } from "../js/analyze.js";
import { split } from "../js/split.js";

const [, , src, codeOut, srcOut] = process.argv;
const text = fs.readFileSync(src, "utf8");
const ticked = analyze(text, "xtensawin").filter((r) => r.ticked).map((r) => r.name);
const s = split(text, ticked);
fs.writeFileSync(codeOut, s.codePy);
fs.writeFileSync(srcOut, s.srcPy);
