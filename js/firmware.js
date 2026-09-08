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
    name: "Metro ESP32-S2", march: "xtensawin", chipfamily: "esp32s2",
    bin: "firmware/adafruit-circuitpython-adafruit_metro_esp32s2-turbo-10.3.0.bin",
    uf2: "firmware/adafruit-circuitpython-adafruit_metro_esp32s2-turbo-10.3.0.uf2",
  },
  adafruit_metro_esp32s3: {
    name: "Metro ESP32-S3", march: "xtensawin", chipfamily: "esp32s3",
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

// Arch by board id, for the no-serial path where _mpy is unreadable. Wider
// than BOARDS: a board can have a known arch without a turbo build published.
// Extends BOARD_ARCH from cli/turbo_cli.py.
export const BOARD_ARCH = {
  // RP2040, Cortex-M0+
  adafruit_feather_rp2040: "armv6m",
  adafruit_feather_rp2040_adalogger: "armv6m",
  adafruit_feather_rp2040_rfm: "armv6m",
  adafruit_feather_rp2040_can: "armv6m",
  adafruit_itsybitsy_rp2040: "armv6m",
  adafruit_qtpy_rp2040: "armv6m",
  adafruit_kb2040: "armv6m",
  adafruit_trinkey_rp2040_qt: "armv6m",
  adafruit_macropad_rp2040: "armv6m",
  raspberry_pi_pico: "armv6m",
  raspberry_pi_pico_w: "armv6m",
  // RP2350, Cortex-M33
  adafruit_feather_rp2350: "armv7emsp",
  adafruit_fruit_jam: "armv7emsp",
  raspberry_pi_pico2: "armv7emsp",
  raspberry_pi_pico2_w: "armv7emsp",
  // SAMD51, Cortex-M4F
  adafruit_feather_m4_express: "armv7emsp",
  adafruit_metro_m4_express: "armv7emsp",
  adafruit_itsybitsy_m4_express: "armv7emsp",
  adafruit_pygamer: "armv7emsp",
  adafruit_pybadge: "armv7emsp",
  // SAMD21, Cortex-M0+
  adafruit_feather_m0_express: "armv6m",
  adafruit_metro_m0_express: "armv6m",
  adafruit_trinket_m0: "armv6m",
  adafruit_qtpy_m0: "armv6m",
  // nRF52840, Cortex-M4F
  adafruit_feather_nrf52840_express: "armv7emsp",
  adafruit_itsybitsy_nrf52840_express: "armv7emsp",
  adafruit_clue_nrf52840_express: "armv7emsp",
  // STM32F4, Cortex-M4F
  adafruit_feather_stm32f405_express: "armv7emsp",
  // Xtensa
  adafruit_feather_esp32s2: "xtensawin",
  adafruit_feather_esp32s3_4mbflash_2mbpsram: "xtensawin",
  adafruit_qtpy_esp32s2: "xtensawin",
  adafruit_qtpy_esp32s3_4mbflash_2mbpsram: "xtensawin",
  adafruit_feather_esp32_v2: "xtensa",
  // RISC-V
  adafruit_qtpy_esp32c3: "rv32imc",
  adafruit_feather_esp32c6: "rv32imc",
};

export function archForBoard(boardId) {
  const b = BOARDS[boardId];
  if (b) return b.march;
  return BOARD_ARCH[boardId] || null;
}

// Every board the page can name an arch for, for the no-serial picker.
export function pickerBoards() {
  const out = {};
  for (const [id, b] of Object.entries(BOARDS)) {
    out[id] = { name: b.name, march: b.march, firmware: true };
  }
  for (const [id, march] of Object.entries(BOARD_ARCH)) {
    if (!out[id]) out[id] = { name: prettyName(id), march, firmware: false };
  }
  return out;
}

function prettyName(id) {
  return id.replace(/^adafruit_/, "").replace(/_/g, " ")
           .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function firmwareFor(boardId) {
  return BOARDS[boardId] || null;
}

// The installer script the board pages load. Same CDN, same version.
const INSTALLER =
  "https://cdn.jsdelivr.net/gh/adafruit/web-firmware-installer-js@2/dist/cpinstaller.min.js";
const CRYPTOJS =
  "https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js";

// The installer's own board-definitions file. Its bucket allows exactly one
// origin, https://circuitpython.org, so the element's fetch in
// connectedCallback fails with "Failed to fetch" anywhere else and the button
// never initializes. Until that bucket's CORS policy carries this page's
// origin, serve a cached copy same-origin for that one URL and leave every
// other request alone. Refresh with tools/fetch-board-defs.sh.
const BOARD_DEFS = "https://adafruit-circuit-python.s3.amazonaws.com/esp32_boards.json";
const BOARD_DEFS_LOCAL = "assets/esp32_boards.json";

let patched = false;
function patchBoardDefsFetch() {
  if (patched) return;
  patched = true;
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input && input.url;
    if (url === BOARD_DEFS) return real(BOARD_DEFS_LOCAL, init);
    return real(input, init);
  };
}

let loading = null;
export function loadInstaller() {
  if (loading) return loading;
  patchBoardDefsFetch();
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
  // Say the chip and the name outright rather than leaning on the cached
  // board definitions; the element prefers these attributes when present.
  if (fw.chipfamily) btn.setAttribute("chipfamily", fw.chipfamily);
  btn.setAttribute("boardname", fw.name);
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
