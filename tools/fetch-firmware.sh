#!/bin/sh
# Pull the turbo firmware binaries into web/firmware/ so the installer button
# serves them same-origin. The repo is private until the announcement, so the
# binaries are not committed; .gitignore keeps them out.
#
#   tools/fetch-firmware.sh [tag]
set -e
TAG="${1:-cp-10.3.0}"
REPO="mikeysklar/turbo"
DIR="$(dirname "$0")/../firmware"
mkdir -p "$DIR"
gh release download "$TAG" -R "$REPO" -D "$DIR" -p '*.bin' -p '*.uf2' --clobber
ls -la "$DIR"
echo
echo "ESP boards need the COMBINED image (bootloader + partitions + app, flashed"
echo "at 0x0). An app-only image is smaller and is flashed at 0x10000; the"
echo "installer button will produce a board that does not boot."
