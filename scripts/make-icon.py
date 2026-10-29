#!/usr/bin/env python3
"""Generate build/icon.png (1024px) and build/icon.icns for the app."""
import os
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
os.makedirs(BUILD, exist_ok=True)

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# macOS-style rounded square with a subtle vertical gradient
margin = int(SIZE * 0.08)
radius = int(SIZE * 0.22)
box = (margin, margin, SIZE - margin, SIZE - margin)
grad = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
top, bottom = (46, 50, 58), (24, 26, 30)
for y in range(box[1], box[3]):
    t = (y - box[1]) / (box[3] - box[1])
    c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
    gd.line([(box[0], y), (box[2], y)], fill=c)
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
img.paste(grad, (0, 0), mask)

# thin border
d.rounded_rectangle(box, radius=radius, outline=(90, 96, 108, 255), width=6)

# terminal window header bar
hx0, hy0 = box[0] + 70, box[1] + 70
hx1, hy1 = box[2] - 70, box[3] - 70
d.rounded_rectangle((hx0, hy0, hx1, hy1), radius=48, fill=(18, 19, 22, 255), outline=(70, 75, 85, 255), width=4)
d.rounded_rectangle((hx0, hy0, hx1, hy0 + 90), radius=48, fill=(52, 56, 64, 255))
d.rectangle((hx0, hy0 + 50, hx1, hy0 + 90), fill=(52, 56, 64, 255))
for i, col in enumerate([(229, 83, 75), (230, 180, 34), (76, 175, 80)]):
    cx = hx0 + 60 + i * 56
    d.ellipse((cx - 16, hy0 + 29, cx + 16, hy0 + 61), fill=col)

# prompt glyph ">_" in accent blue + green cursor block
def font(size):
    for p in ["/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/SFNSMono.ttf", "/Library/Fonts/Arial.ttf"]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

f = font(300)
d.text((hx0 + 90, hy0 + 150), ">", font=f, fill=(78, 161, 255, 255))
d.rectangle((hx0 + 300, hy0 + 330, hx0 + 470, hy0 + 400), fill=(76, 175, 80, 255))
# small "M" badge bottom-right
f2 = font(170)
d.text((hx1 - 230, hy1 - 230), "M", font=f2, fill=(154, 160, 168, 255))

png = os.path.join(BUILD, "icon.png")
img.save(png)

# iconset -> icns
iconset = os.path.join(BUILD, "icon.iconset")
os.makedirs(iconset, exist_ok=True)
for s in [16, 32, 64, 128, 256, 512]:
    img.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}.png"))
    img.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))
subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(BUILD, "icon.icns")], check=True)
print("wrote", png, "and icon.icns")
