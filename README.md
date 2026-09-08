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
| Compile in the page | done, real `mpy-cross` under WebAssembly |
| Install over the REPL | done, with the read-only fallback |
| Measure on the board | done |
| Firmware installer button | wired; the binaries are not committed |

The compiler is the one thing not yet in the page. `js/compile.js` already has
the interface v1 keeps; `mpy/fast-<arch>.mpy` holds the pre-built output of the
native `mpy-cross` for exactly what `split.js` emits from the example, for all
eight arches. Anything else gets a refusal and the download path, never a
wrong file.

## The in-page compiler

CircuitPython's own `mpy-cross`, built at the 10.3.0 tag with emscripten 6.0.9
and shipped in `mpy-cross/10.3.0/`. 440 KB for the pair. It compiles the
example for eight architectures in about 20 ms, and its output is
byte-identical to the native binary for every one of them, which is the
acceptance test in `turbo-web.md` 6.2.

The shallow clone of the stock 10.3.0 tag reproduces all eight `mpy/` modules
byte for byte with a native build, confirming what `turbo-web.md` 3.4 claims:
the fork never touched `mpy-cross/`.

Four things in the stock Makefile assume a native host. `tools/build-wasm.sh`
handles all four.

| Override | Why |
|---|---|
| `LDFLAGS_ARCH=` | the Darwin branch passes `-dead_strip` and `-Wl,-map`, which `wasm-ld` rejects |
| `STRIP=` | the post-link `strip` cannot process a `.js` file |
| `SIZE=true` | neither can `size` |
| a venv with `huffman` | `py/maketranslationdata.py` imports it, and it is rarely on the system python |

`-DMICROPY_NLR_SETJMP=1` is belt and braces. `py/nlr.h:115` already falls back
to setjmp on an unknown architecture, so wasm takes that path regardless.

**The one trap.** Write the source to a *relative* path in the emscripten
filesystem. The `.mpy` embeds the source filename, so compiling `/fast.py`
yields a file exactly one byte larger than compiling `fast.py`, and tracebacks
on the board then read `/fast.py`. That byte was the only difference on the
first run.

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
js/compile.js         mpy-cross under wasm, and the version guard
js/firmware.js        board table and the cp-install-button
examples/             the single-file mandelbrot, and what the split emits
mpy/                  native-built modules, the oracle the wasm is checked against
mpy-cross/10.3.0/     the compiler the page runs
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

## Checks

```sh
node tools/test.mjs        # verdicts, split, probe decoding, compiler
node tools/test-wasm.mjs   # wasm output vs native, all eight architectures
tools/check-split.sh       # the split does not change what the program does
tools/build-mpy.sh         # regenerate the mpy/ oracle from a native mpy-cross
tools/build-wasm.sh        # rebuild the in-page compiler, needs emcc
```

`tools/check-split.sh` runs the example before and after the split on the host
and compares the checksum against `407644`, the known-good value from
`adafruit-turbo/docs/shim-test.md`. Both come out equal.

`node tools/test.mjs` covers the `_mpy` decoding for all five firmware values,
the five verdict kinds, the split's invariants, the line map, and the
compiler. `tools/test-wasm.mjs` adds the acceptance test from `turbo-web.md`
6.2: the in-page compiler's output against the native binary's, byte for byte,
for all eight architectures.

Pre-built module sizes, from the native `mpy-cross` at
`turbo-web/tools/mpy-cross-6.3` (mpy v6.3, built from circuitpython `8c69e71fa9`):

| arch | bytes | `_mpy` |
|---|---|---|
| armv6m | 604 | `0x1306` |
| armv7m / armv7em / armv7emsp / armv7emdp | 552 | `0x1706` … `0x2306` |
| xtensa | 658 | `0x2706` |
| xtensawin | 639 | `0x2b06` |
| rv32imc | 606 | `0x2f06` |

These match the reference sizes in `turbo-web.md` 3.4 exactly.

## Measured on hardware

A Feather RP2040, built from `loader-only-native` with `CIRCUITPY_LOAD_NATIVE=1`
and flashed 2026-09-07. `_mpy` came back `0x1306`, so armv6m with the native
loader. The page's own install and bench, run over the raw REPL:

| | |
|---|---|
| from `/src`, bytecode | 8,335 ms |
| from `/lib/turbo/armv6m`, viper | 422 ms |
| ratio | 19.8x |

The 422 ms matches the farm's Metro RP2040 exactly, and 19.8x sits next to the
19.7x in the CLI's table. Probe took 0.20 s, raw REPL banner 0.18 s.

### Which speedup number the page quotes

There are two tables in the project and they measure different things.

- `cli/turbo_cli.py` `MEASURED`: viper against the same integer source run as
  bytecode. armv6m 19.7x, armv7emsp 16.3x, xtensawin 26.2x.
- `turbo-cli.md` 2.7: viper against a **float** implementation. RP2040 36.3x,
  RP2350 24.4x, C5 44.0x. Bigger, because it includes the gain from rewriting
  the algorithm in fixed point.

The page performs the first comparison, so it quotes the first table. Quoting
36.3x and then measuring 19.8x on the same board would make the page contradict
itself. `turbo-web.md` section 4 specifies the float-baseline numbers; this is
a deliberate departure, backed by the run above.

## Not verified yet

- The WebSerial connect through the browser. The port chooser is Chrome UI, so
  a person has to press Connect and pick the port. Everything behind it is
  verified: the protocol above ran against the board using the byte sequences
  in `js/serial.js`.
- The `cp-install-button` flash itself. The button initializes and carries the
  right URLs, but no board has been flashed through it.
