#!/usr/bin/env bash
# Renders the PWA icons from src/app/icon.svg. Needs librsvg (brew install librsvg).
set -euo pipefail

cd "$(dirname "$0")/.."

SRC=src/app/icon.svg
OUT=public/icons
FOREST='#1C2B1E'
mkdir -p "$OUT"

rsvg-convert -w 192 -h 192 "$SRC" -o "$OUT/icon-192.png"
rsvg-convert -w 512 -h 512 "$SRC" -o "$OUT/icon-512.png"

# iOS and Android launchers apply their own mask, so these two get the artwork
# on an opaque forest square instead of the source's transparent rounded
# corners. The maskable one is inset by 6/64 so the crop leaves a margin.
rsvg-convert -w 180 -h 180 -b "$FOREST" "$SRC" -o src/app/apple-icon.png
rsvg-convert -w 416 -h 416 --page-width 512 --page-height 512 --left 48 --top 48 -b "$FOREST" "$SRC" -o "$OUT/maskable-512.png"

echo "icons written to $OUT and src/app/apple-icon.png"
