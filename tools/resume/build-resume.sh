#!/usr/bin/env bash
# Regenerate assets/docs/Vincent-Armato-Resume.pdf from tools/resume/resume.html.
#
# The PDF has no other source — edit resume.html, never the PDF itself.
# Requires Google Chrome (headless print-to-PDF), which is how the original
# was produced, so output stays consistent.
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/tools/resume/resume.html"
OUT="$ROOT/assets/docs/Vincent-Armato-Resume.pdf"

[ -x "$CHROME" ] || { echo "Google Chrome not found at: $CHROME" >&2; exit 1; }
[ -f "$SRC" ] || { echo "Missing source: $SRC" >&2; exit 1; }

"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT" "file://$SRC" 2>/dev/null

echo "Wrote $OUT"
