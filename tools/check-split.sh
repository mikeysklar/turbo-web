#!/bin/sh
# Prove the split does not change what the program does: run the example
# before and after, on the host, and compare the checksum.
#
# 407644 is the known-good value from adafruit-turbo/docs/shim-test.md.
set -e
cd "$(dirname "$0")/.."
WANT=407644
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# before: the single file as written
sed 's/out: ptr8, width: int, dx: int, cy: int, max_iter: int/out, width, dx, cy, max_iter/' \
  examples/mandelbrot.py > "$TMP/before.py"
BEFORE=$(python3 "$TMP/before.py" | sed 's/.*checksum=\([0-9]*\).*/\1/')

# after: what the page writes to the board
mkdir -p "$TMP/after/src"
node tools/emit-code.mjs examples/mandelbrot.py "$TMP/after/code.py" "$TMP/after/src/fast.py"
sed -i.bak 's/out: ptr8, width: int, dx: int, cy: int, max_iter: int/out, width, dx, cy, max_iter/' \
  "$TMP/after/src/fast.py"
cat > "$TMP/after/turbo.py" <<'PY'
arch = None
path = "/src"
class _T:
    def __call__(self, f): return f
    def native(self, f): return f
    def viper(self, f): return f
turbo = _T()
PY
AFTER=$(cd "$TMP/after" && PYTHONPATH="$TMP/after:$TMP/after/src" python3 code.py \
  | sed 's/.*checksum=\([0-9]*\).*/\1/')

echo "before $BEFORE"
echo "after  $AFTER"
echo "want   $WANT"
[ "$BEFORE" = "$WANT" ] && [ "$AFTER" = "$WANT" ] || { echo "MISMATCH"; exit 1; }
echo "the split preserved the result"
