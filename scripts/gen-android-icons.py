#!/usr/bin/env python3
"""Generate Android launcher/splash resources from native-android/icon-source.png.

Outputs are committed under native-android/res and copied into android/ by
build-apk.sh, so the APK never needs image tooling at build time.

Requires Pillow. Re-run only when the brand mark changes.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'native-android' / 'icon-source.png'
RES = ROOT / 'native-android' / 'res'

BACKGROUND = (0, 0, 0, 255)
MARK = (86, 255, 151, 255)

LAUNCHER_SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
# Adaptive foreground lives on a 108dp canvas; only the middle 72dp is visible.
FOREGROUND_SIZES = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
FOREGROUND_SCALE = 0.56
SQUARE_SCALE = 0.66
ROUND_SCALE = 0.62

SPLASH_SIZES = {
    'drawable': (480, 320),
    'drawable-land-mdpi': (480, 320),
    'drawable-land-hdpi': (800, 480),
    'drawable-land-xhdpi': (1280, 720),
    'drawable-land-xxhdpi': (1600, 960),
    'drawable-land-xxxhdpi': (1920, 1280),
    'drawable-port-mdpi': (320, 480),
    'drawable-port-hdpi': (480, 800),
    'drawable-port-xhdpi': (720, 1280),
    'drawable-port-xxhdpi': (960, 1600),
    'drawable-port-xxxhdpi': (1280, 1920),
}
SPLASH_SCALE = 0.30

ADAPTIVE_ICON = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
"""

LAUNCHER_BACKGROUND = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#000000</color>
</resources>
"""


def load_mark() -> Image.Image:
    """Brand mark on transparent pixels, cropped to its bounding box.

    The source art is green on opaque black, so the green channel doubles as the
    alpha mask and keeps antialiased edges intact.
    """
    src = Image.open(SOURCE).convert('RGBA')
    alpha = src.getchannel('G')
    mark = Image.new('RGBA', src.size, MARK[:3] + (0,))
    mark.putalpha(alpha)
    box = mark.getbbox()
    return mark.crop(box) if box else mark


def centered(canvas: Image.Image, mark: Image.Image, scale: float) -> None:
    side = max(1, round(min(canvas.size) * scale))
    resized = mark.resize((side, side), Image.LANCZOS)
    x = (canvas.width - side) // 2
    y = (canvas.height - side) // 2
    canvas.alpha_composite(resized, (x, y))


def rounded_square(size: int, mark: Image.Image) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * 0.22), fill=BACKGROUND)
    centered(canvas, mark, SQUARE_SCALE)
    return canvas


def circle(size: int, mark: Image.Image) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((0, 0, size - 1, size - 1), fill=BACKGROUND)
    centered(canvas, mark, ROUND_SCALE)
    return canvas


def foreground(size: int, mark: Image.Image) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    centered(canvas, mark, FOREGROUND_SCALE)
    return canvas


def splash(width: int, height: int, mark: Image.Image) -> Image.Image:
    canvas = Image.new('RGBA', (width, height), BACKGROUND)
    centered(canvas, mark, SPLASH_SCALE)
    return canvas


def write(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, 'PNG', optimize=True)
    print(f'wrote {path.relative_to(ROOT)} ({image.width}x{image.height})')


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f'missing icon source: {SOURCE}')

    if RES.exists():
        shutil.rmtree(RES)
    mark = load_mark()

    for density, size in LAUNCHER_SIZES.items():
        write(rounded_square(size, mark), RES / f'mipmap-{density}' / 'ic_launcher.png')
        write(circle(size, mark), RES / f'mipmap-{density}' / 'ic_launcher_round.png')

    for density, size in FOREGROUND_SIZES.items():
        write(foreground(size, mark), RES / f'mipmap-{density}' / 'ic_launcher_foreground.png')

    for directory, (width, height) in SPLASH_SIZES.items():
        write(splash(width, height, mark), RES / directory / 'splash.png')

    for name in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        path = RES / 'mipmap-anydpi-v26' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(ADAPTIVE_ICON)
        print(f'wrote {path.relative_to(ROOT)}')

    path = RES / 'values' / 'ic_launcher_background.xml'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(LAUNCHER_BACKGROUND)
    print(f'wrote {path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
