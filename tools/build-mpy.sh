#!/bin/sh
# Regenerate mpy/fast-<arch>.mpy: the stub compiler's pre-built modules.
#
# The source is exactly what js/split.js emits for examples/mandelbrot.py,
# compiled by a native mpy-cross. It is compiled from a file literally named
# fast.py so the .mpy carries that name in tracebacks and the byte count the
# page reports is the real one.
#
#   tools/build-mpy.sh [path/to/mpy-cross]
set -e
cd "$(dirname "$0")/.."
MC="${1:-tools/mpy-cross-6.3}"
[ -x "$MC" ] || { echo "no mpy-cross at $MC"; exit 1; }
MC="$(cd "$(dirname "$MC")" && pwd)/$(basename "$MC")"

node tools/emit-example.mjs examples/mandelbrot.py examples/mandelbrot-fast.py examples/mandelbrot-src.py

TMP="$(mktemp -d)"
cp examples/mandelbrot-fast.py "$TMP/fast.py"
( cd "$TMP" && for a in armv6m armv7m armv7em armv7emsp armv7emdp xtensa xtensawin rv32imc; do
    "$MC" -march="$a" fast.py -o "out-$a.mpy"
  done )
for a in armv6m armv7m armv7em armv7emsp armv7emdp xtensa xtensawin rv32imc; do
  cp "$TMP/out-$a.mpy" "mpy/fast-$a.mpy"
  printf "%-10s %s B\n" "$a" "$(wc -c < "mpy/fast-$a.mpy" | tr -d ' ')"
done
rm -rf "$TMP"
"$MC" --version
