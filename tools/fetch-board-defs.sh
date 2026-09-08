#!/bin/sh
# Refresh the cached copy of the installer's board definitions.
#
# js/firmware.js serves this file in place of the S3 URL, because that bucket's
# CORS policy names exactly one origin (https://circuitpython.org). From any
# other origin the element's fetch fails and the install button never
# initializes. Drop the workaround once the bucket allows this page's origin.
set -e
cd "$(dirname "$0")/.."
curl -sfL -o assets/esp32_boards.json \
  https://adafruit-circuit-python.s3.amazonaws.com/esp32_boards.json
python3 -c "import json;d=json.load(open('assets/esp32_boards.json'));print(len(d),'boards')"
