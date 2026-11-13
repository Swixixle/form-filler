# Draws the app icon: a page with three written lines and a tick, on Form Filler's green. Run once; the PNGs are kept.
from PIL import Image, ImageDraw
import os
here = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
GREEN, PAPER, INK, TICK = (19, 59, 52), (247, 250, 246), (13, 26, 89), (79, 143, 90)
def icon(size, maskable=False):
    s = size / 512; im = Image.new('RGB', (size, size), GREEN); d = ImageDraw.Draw(im)
    pad = 120 if maskable else 92                       # a maskable icon keeps its drawing inside the safe circle
    x0, y0, x1, y1 = pad * s, (pad - 10) * s, (512 - pad) * s, (512 - pad + 10) * s
    d.rounded_rectangle((x0, y0, x1, y1), radius=26 * s, fill=PAPER)
    for row in range(3):
        y = y0 + (95 + row * 85) * s * (512 - 2 * pad) / 328
        d.line((x0 + 44 * s, y, x1 - 44 * s, y), fill=(150, 170, 158), width=max(2, round(7 * s)))
        d.line((x0 + 50 * s, y - 14 * s, x0 + (120 + row * 40) * s, y - 14 * s), fill=INK, width=max(2, round(14 * s)))
    cx, cy = x1 - 70 * s, y1 - 76 * s
    d.line((cx - 40 * s, cy, cx - 12 * s, cy + 28 * s, cx + 40 * s, cy - 34 * s), fill=TICK, width=max(3, round(22 * s)), joint='curve')
    return im
icon(192).save(os.path.join(here, 'icon-192.png')); icon(512).save(os.path.join(here, 'icon-512.png'))
icon(512, True).save(os.path.join(here, 'maskable-512.png')); icon(180).save(os.path.join(here, 'apple-touch-icon.png'))
print('wrote icons')
