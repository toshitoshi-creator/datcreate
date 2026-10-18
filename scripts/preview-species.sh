#!/usr/bin/env bash
# Dev tool: render each species in the real app and build a contact sheet.
# Usage: scripts/preview-species.sh OUTDIR "bear dog ..." "17:720,18:720"
set -euo pipefail
OUT="$1"; SPECIES_LIST="$2"; CASES="${3:-17:720,18:720}"
mkdir -p "$OUT"
for sp in $SPECIES_LIST; do
  SPECIES=$sp PREVIEW_DIR="$OUT" PREVIEW="$CASES" npx playwright test preview --reporter=dot >/dev/null
done
python3 - "$OUT" <<'PY'
import sys, glob
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + '/*.png'))
files = [f for f in files if not f.endswith('sheet.png')]
cols = 4
ims = [Image.open(f).crop((0, 450, 1170, 2050)).resize((240, 328)) for f in files]
rows = (len(ims) + cols - 1) // cols
out = Image.new('RGB', (240 * cols, 328 * rows))
for i, im in enumerate(ims):
    out.paste(im, ((i % cols) * 240, (i // cols) * 328))
out.save(sys.argv[1] + '/sheet.png')
print('\n'.join(f.split('/')[-1] for f in files))
PY
