#!/bin/sh
# WebSerial needs a secure context: localhost counts, file:// does not.
cd "$(dirname "$0")/.."
echo "http://localhost:8000/"
exec python3 -m http.server 8000
