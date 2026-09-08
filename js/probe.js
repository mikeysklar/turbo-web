// Decode sys.implementation._mpy and the probe line. turbo-web.md 3.1.
//
// version = _mpy & 0xff, sub = (_mpy >> 8) & 3, arch = (_mpy >> 10) & 0x3f.
// arch == 0 means the firmware has no native loader. Nothing else reports it.

export const ARCH = {
  4: "armv6m", 5: "armv7m", 6: "armv7em", 7: "armv7emsp", 8: "armv7emdp",
  9: "xtensa", 10: "xtensawin", 11: "rv32imc",
};

export const PROBE_CODE =
  'import sys,os,board;print(sys.implementation._mpy,os.uname().version,' +
  'os.uname().machine,board.board_id,sep="|")\n';

export function decodeMpy(mpy) {
  return {
    mpy,
    mpyVersion: mpy & 0xff,
    mpySub: (mpy >> 8) & 3,
    archId: (mpy >> 10) & 0x3f,
    march: ARCH[(mpy >> 10) & 0x3f] || null,
    loader: ((mpy >> 10) & 0x3f) !== 0,
  };
}

export function mpyLabel(d) {
  return `mpy v${d.mpyVersion}.${d.mpySub}`;
}

// "1543|10.3.0 on 2026-08-31|Metro ESP32-S3 with ESP32S3|adafruit_metro_esp32s3"
export function parseProbe(line) {
  const text = String(line).trim().split(/\r?\n/).filter(Boolean).pop() || "";
  const parts = text.split("|");
  if (parts.length < 4) throw new Error(`probe returned ${JSON.stringify(text)}`);
  const mpy = parseInt(parts[0], 10);
  if (Number.isNaN(mpy)) throw new Error(`probe returned ${JSON.stringify(text)}`);
  return {
    ...decodeMpy(mpy),
    cpVersion: parts[1].split(" on ")[0].trim(),
    buildDate: (parts[1].split(" on ")[1] || "").trim(),
    machine: parts[2].trim(),
    boardId: parts[3].trim(),
  };
}

// boot_out.txt, for the no-serial path. Line 1 is
// "Adafruit CircuitPython 10.3.0 on 2026-08-31; Metro ESP32-S3 with ESP32S3",
// line 2 "Board ID:adafruit_metro_esp32s3". Loader presence is not in here.
export function parseBootOut(text) {
  const lines = text.split(/\r?\n/);
  const m = /CircuitPython\s+(\S+)\s+on\s+([0-9-]+);\s*(.+)$/.exec(lines[0] || "");
  const idLine = lines.find((l) => /^Board ID:/.test(l)) || "";
  return {
    cpVersion: m ? m[1] : null,
    buildDate: m ? m[2] : null,
    machine: m ? m[3].trim() : null,
    boardId: idLine.replace(/^Board ID:\s*/, "").trim() || null,
  };
}
