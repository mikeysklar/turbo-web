// Board id -> arch and turbo firmware files. turbo-web.md 3.3 and 6.3.
//
// The firmware repo is private until the announcement, so v0 serves the
// binaries from ./firmware/ same-origin (CORS never applies, and the
// installer reads them as plain attributes). tools/fetch-firmware.sh pulls
// them from the fork's cp-10.3.0 release.
//
// For ESP boards `bin` must be the COMBINED image (bootloader + partition
// table + app, flashed at 0x0), not the app-only image flashed at 0x10000.

export const TURBO_VERSION = "10.3.0";

export const BOARDS = {
  adafruit_metro_rp2040: {
    name: "Metro RP2040", march: "armv6m",
    uf2: "firmware/adafruit-circuitpython-adafruit_metro_rp2040-turbo-10.3.0.uf2",
  },
  adafruit_metro_rp2350: {
    name: "Metro RP2350", march: "armv7emsp",
    uf2: "firmware/adafruit-circuitpython-adafruit_metro_rp2350-turbo-10.3.0.uf2",
  },
  adafruit_metro_esp32s2: {
    name: "Metro ESP32-S2", march: "xtensawin",
    bin: "firmware/adafruit-circuitpython-adafruit_metro_esp32s2-turbo-10.3.0.bin",
    uf2: "firmware/adafruit-circuitpython-adafruit_metro_esp32s2-turbo-10.3.0.uf2",
  },
  adafruit_metro_esp32s3: {
    name: "Metro ESP32-S3", march: "xtensawin",
    bin: "firmware/adafruit-circuitpython-adafruit_metro_esp32s3-turbo-10.3.0.bin",
    uf2: "firmware/adafruit-circuitpython-adafruit_metro_esp32s3-turbo-10.3.0.uf2",
  },
  adafruit_feather_nrf52840_express: {
    name: "Feather nRF52840 Express", march: "armv7emsp",
    uf2: "firmware/adafruit-circuitpython-feather_nrf52840_express-turbo-10.3.0.uf2",
  },
  adafruit_feather_stm32f405_express: {
    name: "Feather STM32F405 Express", march: "armv7emsp",
    uf2: "firmware/adafruit-circuitpython-feather_stm32f405_express-turbo-10.3.0.uf2",
  },
};

// Arch by board id, for the no-serial path where _mpy is unreadable.
export function archForBoard(boardId) {
  const b = BOARDS[boardId];
  return b ? b.march : null;
}

export function firmwareFor(boardId) {
  return BOARDS[boardId] || null;
}

// The installer script the board pages load. Same CDN, same version.
const INSTALLER =
  "https://cdn.jsdelivr.net/gh/adafruit/web-firmware-installer-js@2/dist/cpinstaller.min.js";
const CRYPTOJS =
  "https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js";

let loading = null;
export function loadInstaller() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const a = document.createElement("script");
    a.src = CRYPTOJS;
    a.onload = () => {
      const b = document.createElement("script");
      b.type = "module";
      b.src = INSTALLER;
      b.onload = () => resolve(true);
      b.onerror = () => reject(new Error("could not load the CircuitPython installer"));
      document.head.appendChild(b);
    };
    a.onerror = () => reject(new Error("could not load crypto-js"));
    document.head.appendChild(a);
  });
  return loading;
}

// <button is="cp-install-button" boardid=... binfile=... uf2file=... version=...>
export function installButton(boardId, label) {
  const fw = firmwareFor(boardId);
  if (!fw) return null;
  const btn = document.createElement("button", { is: "cp-install-button" });
  btn.setAttribute("is", "cp-install-button");
  btn.setAttribute("boardid", boardId);
  if (fw.bin) btn.setAttribute("binfile", new URL(fw.bin, location.href).href);
  if (fw.uf2) btn.setAttribute("uf2file", new URL(fw.uf2, location.href).href);
  btn.setAttribute("version", TURBO_VERSION);
  btn.className = "btn primary always";
  btn.textContent = label || "Install turbo firmware";
  return btn;
}

// Is the file actually on disk next to the page? v0 ships without them.
export async function firmwarePresent(boardId) {
  const fw = firmwareFor(boardId);
  if (!fw) return false;
  const url = fw.bin || fw.uf2;
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch (e) {
    return false;
  }
}
