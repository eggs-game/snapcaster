#!/usr/bin/env python3
"""Bayer 4x4 ordered dither, reverse-engineered to match the ascii-magic.com
'Dither' style (Bayer 4x4 algorithm, vignette/bloom off, defaults otherwise):
half-resolution processing upscaled 2x with nearest-neighbor (the tool's
default dither cell size), contrast-stretched grayscale, thresholded against
a tiled 4x4 Bayer matrix.
"""
import os
import sys
from PIL import Image
import numpy as np

BAYER_4X4 = 15 - np.array([
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
])
THRESHOLD = (BAYER_4X4 + 0.5) / 16.0


def dither(im: Image.Image) -> Image.Image:
    w, h = im.size
    # Ceiling division: the observed 2x2 block structure pairs pixels from
    # the start, leaving a final unpaired row/col on odd dimensions.
    sw, sh = max(1, -(-w // 2)), max(1, -(-h // 2))

    small = im.convert("L").resize((sw, sh), Image.LANCZOS)
    arr = np.array(small).astype(float)

    lo, hi = np.percentile(arr, 2), np.percentile(arr, 98)
    gray = np.clip((arr - lo) / (hi - lo + 1e-6), 0, 1)

    ty = np.tile(np.arange(sh)[:, None] % 4, (1, sw))
    tx = np.tile(np.arange(sw)[None, :] % 4, (sh, 1))
    thresh_tile = THRESHOLD[ty, tx]

    bw = (gray > thresh_tile).astype(np.uint8) * 255
    # Upscale by exact integer repeat (matches the observed block structure
    # precisely, unlike a resize which drifts on non-integer scale factors),
    # then crop back to the exact original size.
    big = np.repeat(np.repeat(bw, 2, axis=0), 2, axis=1)[:h, :w]
    return Image.fromarray(big, mode="L").convert("RGBA")


if __name__ == "__main__":
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    files = sorted(f for f in os.listdir(src_dir) if f.lower().endswith(".png"))
    for f in files:
        im = Image.open(os.path.join(src_dir, f))
        dither(im).save(os.path.join(out_dir, f))
    print(f"Dithered {len(files)} images -> {out_dir}")
