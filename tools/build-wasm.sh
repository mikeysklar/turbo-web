#!/bin/sh
# Build mpy-cross for the browser. turbo-web.md 6.2.
#
#   tools/build-wasm.sh [path/to/circuitpython/checkout]
#
# Needs emscripten (brew install emscripten) and a CircuitPython source tree at
# the 10.3.0 tag. Without a tree it makes a shallow clone in a temp directory.
#
# Four things the stock Makefile does that have to be turned off, all because
# it assumes a native host:
#   LDFLAGS_ARCH=  the Darwin branch passes -dead_strip and -Wl,-map, which
#                  wasm-ld rejects
#   STRIP=         the post-link strip cannot process a .js file
#   SIZE=true      neither can size
#   MICROPY_NLR_SETJMP=1  belt and braces; py/nlr.h:115 already falls back to
#                  setjmp on an unknown arch
set -e
cd "$(dirname "$0")/.."
OUT="$(pwd)/mpy-cross/10.3.0"
TAG=10.3.0

command -v emcc >/dev/null || { echo "emcc not found. brew install emscripten"; exit 1; }

CP="$1"
TMP=""
if [ -z "$CP" ]; then
  TMP="$(mktemp -d)"
  echo "cloning circuitpython $TAG into $TMP"
  git clone --depth 1 --branch "$TAG" --no-recurse-submodules \
    https://github.com/adafruit/circuitpython.git "$TMP/cp" >/dev/null 2>&1
  CP="$TMP/cp"
fi
[ -d "$CP/mpy-cross" ] || { echo "no mpy-cross/ under $CP"; exit 1; }

# py/maketranslationdata.py needs huffman, which is usually not on the system
# python. Keep it in a throwaway venv rather than touching the user's.
VENV="$(mktemp -d)/venv"
python3 -m venv "$VENV"
"$VENV/bin/pip" install -q huffman
PATH="$VENV/bin:$PATH"
export PATH

cd "$CP/mpy-cross"
rm -rf build-wasm
make CROSS_COMPILE= CC=emcc BUILD=build-wasm PROG=mpy-cross.mjs \
  LDFLAGS_ARCH= STRIP= SIZE=true \
  CFLAGS_EXTRA="-DMICROPY_NLR_SETJMP=1" \
  LDFLAGS_EXTRA="-Os -sEXPORTED_RUNTIME_METHODS=FS,callMain -sEXIT_RUNTIME=1 \
-sALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createMpyCross \
-sINVOKE_RUN=0 -sFILESYSTEM=1" \
  -j8

mkdir -p "$OUT"
cp build-wasm/mpy-cross.mjs build-wasm/mpy-cross.wasm "$OUT/"
ls -la "$OUT"
[ -n "$TMP" ] && rm -rf "$TMP"
echo
echo "now prove it: node tools/test-wasm.mjs"
