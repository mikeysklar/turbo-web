# turbo-web

A static page that connects to a CircuitPython board over WebSerial, reads
what it is, takes a `code.py`, says honestly which functions are worth
compiling, shows the split before writing anything, installs the result, and
measures before and after on the board itself.

Built to the spec in `turbo-web.md`; the visual language is lifted from
section 4 of `turbo-two-routes.html`.

## Run it

```sh
tools/serve.sh          # http://localhost:8000/
```

WebSerial needs a secure context. `localhost` counts, `file://` does not.
Chrome or Edge on a desktop. Every other browser gets the board picker and
the download path.

## Where it stands

v0, per `turbo-web.md` section 6.1.

| Piece | State |
|---|---|
| Panels, tokens, copy | done, from the mock |
| WebSerial connect, raw REPL, probe | done |
| Verdicts | done, JS line scanner mirroring `cli/turbo_cli.py` |
| Split | done, and shown before anything is written |
| Compile | **stub**: pre-built `.mpy` for the mandelbrot example only |
| Install over the REPL | done, with the read-only fallback |
| Measure on the board | done |
| Firmware installer button | wired; the binaries are not committed |

The compiler is the one thing not yet in the page. `js/compile.js` already has
the interface v1 keeps; `mpy/fast-<arch>.mpy` holds the pre-built output of the
native `mpy-cross` for exactly what `split.js` emits from the example, for all
eight arches. Anything else gets a refusal and the download path, never a
wrong file.

## Firmware binaries

Not committed, because the fork is private until the announcement.

```sh
tools/fetch-firmware.sh          # gh release download cp-10.3.0
```

For ESP boards the `.bin` must be the **combined** image (bootloader +
partition table + app, flashed at 0x0). The app-only image is smaller and is
flashed at 0x10000; the installer button would produce a board that does not
boot.

## Layout

```
index.html            the page
style.css             tokens and classes from turbo-two-routes.html
js/app.js             state machine, panel wiring
js/serial.js          WebSerial + raw REPL: connect, exec, writeFile
js/probe.js           sys.implementation._mpy and boot_out.txt decoding
js/analyze.js         verdicts
js/split.js           code.py -> code.py + src/fast.py + fast.mpy
js/compile.js         mpy-cross: stub now, wasm later, one interface
js/firmware.js        board table and the cp-install-button
examples/             the single-file mandelbrot, and what the split emits
mpy/                  pre-built modules for the stub compiler
assets/turbo.py       the shim, written to /lib on the board when missing
```

## Facts it relies on

- `sys.implementation._mpy`: `arch = (_mpy >> 10) & 0x3f`, and **`arch == 0`
  means no native loader**. Nothing else reports it.
- `code.py` runs from source on every boot, and `.py` beats `.mpy` in the same
  directory. The page cannot hand back a faster `code.py`; it moves the hot
  function into a module and imports it back.
- Speedups are only ever quoted as "similar loops ran Nx on <board>", from the
  farm's measured table. No number is interpolated for an arch without one.

## Checked on the host

- The example still prints checksum `407644` after the split.
- The eight `mpy/fast-*.mpy` files come from the native `mpy-cross` at
  `cp-esp32-native/mpy-cross/build/mpy-cross` (mpy v6.3).
