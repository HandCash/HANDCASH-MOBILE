#!/usr/bin/env python3
"""Generate the iOS app icon and splash from native-android/icon-source.png.

Outputs are committed under native-ios/res and copied into ios/ by
scripts/patch-ios.mjs, so the iOS build never needs image tooling.

Requires Pillow. Re-run only when the brand mark changes.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'native-ios' / 'res'

_spec = importlib.util.spec_from_file_location('android_icons', ROOT / 'scripts' / 'gen-android-icons.py')
android_icons = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(android_icons)

ICON_SIZE = 1024
SPLASH_SIZE = 2732


def opaque(image: Image.Image) -> Image.Image:
    """App Store Connect rejects an app icon with an alpha channel."""
    return image.convert('RGB')


def main() -> None:
    mark = android_icons.load_mark()

    # Full bleed: iOS applies its own corner mask.
    icon = Image.new('RGBA', (ICON_SIZE, ICON_SIZE), android_icons.BACKGROUND)
    android_icons.centered(icon, mark, android_icons.SQUARE_SCALE)
    android_icons.write(opaque(icon), RES / 'AppIcon-1024.png')

    splash = android_icons.splash(SPLASH_SIZE, SPLASH_SIZE, mark)
    android_icons.write(opaque(splash), RES / 'splash-2732x2732.png')


if __name__ == '__main__':
    main()
