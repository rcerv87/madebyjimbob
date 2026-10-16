"""Makes the apps' icons and launch screens from JimBob's art (needs Python 3 with Pillow).

    python mobile/scripts/make-icons.py [--art web/public/icons/icon-512.png]

Writes over the files Capacitor generated (same names and sizes), so it can be run again whenever the art changes.
A larger original (1024 px or more) gives the App Store icon, which is 1024 px, a sharper look.
"""
import argparse
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID_RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
IOS_ASSETS = os.path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets')
DARK = (0x16, 0x1A, 0x21)  # the site's background (#161a21)
TEAL = (0x27, 0x71, 0x7A)  # the brand teal (#27717A)

# Android launcher icons: size in px per density (48 dp), and the adaptive icon's foreground layer (108 dp).
LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FOREGROUND = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}


def resized(art, size):
    return art.resize((size, size), Image.LANCZOS)


def round_icon(art, size):
    icon = resized(art, size).convert('RGBA')
    mask = Image.new('L', (size * 4, size * 4), 0)
    from PIL import ImageDraw

    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    icon.putalpha(mask.resize((size, size), Image.LANCZOS))
    return icon


def foreground(art, size):
    # Launchers crop the adaptive icon to its middle two thirds (and round it): the art sits inside that, on teal.
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inner = round(size * 0.70)
    layer.paste(resized(art, inner).convert('RGBA'), ((size - inner) // 2, (size - inner) // 2))
    return layer


def splash(art, width, height):
    # The launch screen: the dark background with JimBob's picture in the middle.
    screen = Image.new('RGB', (width, height), DARK)
    side = round(min(width, height) * 0.32)
    screen.paste(resized(art, side), ((width - side) // 2, (height - side) // 2))
    return screen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--art', default=os.path.join(ROOT, '..', 'web', 'public', 'icons', 'icon-512.png'))
    art = Image.open(parser.parse_args().art).convert('RGB')

    for density, size in LEGACY.items():
        folder = os.path.join(ANDROID_RES, f'mipmap-{density}')
        resized(art, size).save(os.path.join(folder, 'ic_launcher.png'))
        round_icon(art, size).save(os.path.join(folder, 'ic_launcher_round.png'))
        foreground(art, FOREGROUND[density]).save(os.path.join(folder, 'ic_launcher_foreground.png'))
    with open(os.path.join(ANDROID_RES, 'values', 'ic_launcher_background.xml'), 'w', newline='\n') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="ic_launcher_background">#27717A</color>\n</resources>\n')

    for folder in sorted(os.listdir(ANDROID_RES)):
        path = os.path.join(ANDROID_RES, folder, 'splash.png')
        if os.path.exists(path):
            w, h = Image.open(path).size
            splash(art, w, h).save(path)

    # iPhone: one 1024 px icon (no transparency allowed) and the launch screen images.
    resized(art, 1024).save(os.path.join(IOS_ASSETS, 'AppIcon.appiconset', 'AppIcon-512@2x.png'))
    splash_dir = os.path.join(IOS_ASSETS, 'Splash.imageset')
    for name in os.listdir(splash_dir):
        if name.endswith('.png'):
            path = os.path.join(splash_dir, name)
            w, h = Image.open(path).size
            splash(art, w, h).save(path)
    print('Icons and launch screens written.')


if __name__ == '__main__':
    main()
