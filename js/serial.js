// Raw REPL over WebSerial. turbo-web.md section 3.2.
//
// 115200 baud. \r\x03\x03 interrupts, \r\x01 enters raw mode and the board
// answers "raw REPL; CTRL-B to exit\r\n>". Each exec is: code, \x04, then
// "OK", stdout up to \x04, stderr up to \x04, then ">". \r\x02 leaves.

const ENC = new TextEncoder();
const DEC = new TextDecoder();

export class Board {
  constructor(port) {
    this.port = port;
    this.reader = null;
    this.writer = null;
    this.buf = "";
    this.raw = false;
    this.onLost = null;
  }

  static supported() {
    return "serial" in navigator;
  }

  static async request() {
    // Adafruit VID first; the picker offers "show all" for other vendors.
    const port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: 0x239a }],
    });
    return new Board(port);
  }

  async open() {
    await this.port.open({ baudRate: 115200 });
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.port.addEventListener("disconnect", () => {
      if (this.onLost) this.onLost();
    });
    this._pump();
  }

  async _pump() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buf += DEC.decode(value, { stream: true });
      }
    } catch (e) {
      // closed underneath us; enterRaw/exec surface the failure
    }
  }

  async _write(s) {
    await this.writer.write(ENC.encode(s));
  }

  // Wait until `needle` shows up in the stream, return everything before it.
  async _until(needle, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.buf.indexOf(needle);
      if (i >= 0) {
        const head = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + needle.length);
        return head;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${JSON.stringify(needle)}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async enterRaw() {
    this.buf = "";
    await this._write("\r\x03\x03");       // stop code.py
    await new Promise((r) => setTimeout(r, 150));
    this.buf = "";
    await this._write("\r\x01");           // raw mode
    await this._until("raw REPL; CTRL-B to exit\r\n>", 4000);
    this.raw = true;
  }

  async exitRaw() {
    if (!this.raw) return;
    await this._write("\r\x02");
    this.raw = false;
  }

  // Run `code`, resolve {out, err}. Throws only on protocol/timeout trouble;
  // a Python traceback comes back in `err`.
  async exec(code, timeoutMs = 15000) {
    if (!this.raw) await this.enterRaw();
    this.buf = "";
    await this._write(code);
    await this._write("\x04");
    await this._until("OK", 5000);
    const out = await this._until("\x04", timeoutMs);
    const err = await this._until("\x04", 2000);
    await this._until(">", 2000);
    return { out, err };
  }

  async close() {
    try { await this.exitRaw(); } catch (e) { /* going away anyway */ }
    try { await this.reader.cancel(); } catch (e) {}
    try { this.reader.releaseLock(); } catch (e) {}
    try { this.writer.releaseLock(); } catch (e) {}
    try { await this.port.close(); } catch (e) {}
  }

  // ------------------------------------------------------------ files

  async mkdirp(path) {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur += "/" + p;
      const { err } = await this.exec(
        `import os\ntry:\n    os.mkdir(${JSON.stringify(cur)})\nexcept OSError:\n    pass\n`
      );
      if (err.trim()) throw new Error(err.trim().split("\n").pop());
    }
  }

  // Write bytes to `path`, base64 in ~512 byte chunks so the REPL input
  // buffer never overflows. Read-only filesystems raise OSError 30 here.
  async writeFile(path, bytes, onProgress) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) await this.mkdirp(dir);

    let r = await this.exec(
      `import binascii\nf=open(${JSON.stringify(path)},"wb")\n`
    );
    if (r.err.trim()) throw new Error(cleanErr(r.err));

    const CHUNK = 384; // 384 raw bytes -> 512 base64 chars
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const b64 = b64encode(bytes.subarray(i, i + CHUNK));
      r = await this.exec(`f.write(binascii.a2b_base64("${b64}"))\n`);
      if (r.err.trim()) throw new Error(cleanErr(r.err));
      if (onProgress) onProgress(Math.min(i + CHUNK, bytes.length), bytes.length);
    }
    r = await this.exec("f.close()\n");
    if (r.err.trim()) throw new Error(cleanErr(r.err));
  }

  async writeText(path, text) {
    return this.writeFile(path, ENC.encode(text));
  }

  async exists(path) {
    const { out } = await this.exec(
      `import os\ntry:\n    os.stat(${JSON.stringify(path)})\n    print(1)\nexcept OSError:\n    print(0)\n`
    );
    return out.trim().endsWith("1");
  }
}

function b64encode(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

export function cleanErr(err) {
  const lines = err.trim().split(/\r?\n/).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : err.trim();
}

export function isReadOnly(msg) {
  return /Errno 30|Read-only filesystem/i.test(msg);
}
