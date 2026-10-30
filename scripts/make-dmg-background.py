#!/usr/bin/env python3
"""Generate build/dmg-background.png (600x400) and build/dmg-background@2x.png for the DMG window.

Layout matches build.dmg.contents in package.json: app icon at (150,190), Applications link at (450,190).
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")


def font(size):
    for f in ("/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                pass
    return ImageFont.load_default()


def render(scale):
    w, h = 600 * scale, 400 * scale
    img = Image.new("RGB", (w, h), (30, 32, 38))
    d = ImageDraw.Draw(img)
    # subtle top band
    d.rectangle([0, 0, w, 56 * scale], fill=(38, 41, 48))
    d.text((24 * scale, 16 * scale), "MobAlt", fill=(234, 236, 240), font=font(22 * scale))
    d.text((112 * scale, 21 * scale), "SSH · SFTP · terminal workbench for macOS", fill=(140, 146, 160), font=font(14 * scale))
    # arrow between the two icons (icons are centred at x=150 / x=450, y=190; iconSize 110)
    y = 190 * scale
    x0, x1 = 225 * scale, 375 * scale
    d.line([x0, y, x1 - 14 * scale, y], fill=(110, 170, 255), width=6 * scale)
    d.polygon([(x1, y), (x1 - 26 * scale, y - 16 * scale), (x1 - 26 * scale, y + 16 * scale)], fill=(110, 170, 255))
    msg = "Drag MobAlt to the Applications folder"
    f = font(15 * scale)
    tw = d.textlength(msg, font=f)
    d.text(((w - tw) / 2, 300 * scale), msg, fill=(170, 176, 190), font=f)
    return img


render(1).save(os.path.join(BUILD, "dmg-background.png"))
render(2).save(os.path.join(BUILD, "dmg-background@2x.png"))
print("wrote build/dmg-background.png and @2x")
