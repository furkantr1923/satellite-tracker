"""Uygulama ikonlarını üretir (Windows .ico/.png, Android mipmap, Android açılış).
Kullanım: python3 scripts/make-icons.py   (Pillow gerekir)"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
NAVY, WHITE, RED = (11, 29, 58, 255), (255, 255, 255, 255), (252, 61, 33, 255)


def emblem(size: int, bg_rounded: bool = True) -> Image.Image:
    s = size * 4  # süper örnekleme → yumuşak kenarlar
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg_rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=NAVY)
    c, w = s / 2, max(2, int(s * 0.022))
    r = s * 0.25
    d.ellipse([c - r, c - r, c + r, c + r], outline=WHITE, width=w)
    d.ellipse([c - r * 0.42, c - r, c + r * 0.42, c + r], outline=WHITE, width=int(w * 0.8))
    d.line([c - r, c, c + r, c], fill=WHITE, width=int(w * 0.8))
    # Eğik kırmızı yörünge
    orbit = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    od = ImageDraw.Draw(orbit)
    od.ellipse([c - s * 0.42, c - s * 0.14, c + s * 0.42, c + s * 0.14], outline=RED, width=int(w * 1.6))
    orbit = orbit.rotate(28, resample=Image.BICUBIC, center=(c, c))
    im.alpha_composite(orbit)
    sx, sy, sr = c + s * 0.355, c - s * 0.19, s * 0.05
    d = ImageDraw.Draw(im)
    d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=WHITE)
    return im.resize((size, size), Image.LANCZOS)


def main() -> None:
    t = ROOT / 'src-tauri' / 'icons'
    t.mkdir(parents=True, exist_ok=True)
    big = emblem(1024)
    big.save(ROOT / 'resources' / 'icon-1024.png')
    for name, px in [('32x32.png', 32), ('128x128.png', 128), ('128x128@2x.png', 256), ('icon.png', 512)]:
        emblem(px).save(t / name)
    big.save(t / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    a = ROOT / 'resources' / 'android'
    for dens, px in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
        out = a / f'mipmap-{dens}'
        out.mkdir(parents=True, exist_ok=True)
        emblem(px).save(out / 'ic_launcher.png')
        emblem(px).save(out / 'ic_launcher_round.png')
        # Uyarlanabilir ikon ön planı (108dp tuval, 72dp güvenli alan)
        fg = Image.new('RGBA', (int(px * 2.25), int(px * 2.25)), (0, 0, 0, 0))
        inner = emblem(int(px * 1.5), bg_rounded=False)
        fg.alpha_composite(inner, ((fg.width - inner.width) // 2, (fg.height - inner.height) // 2))
        fg.save(out / 'ic_launcher_foreground.png')
    print('İkonlar üretildi.')


if __name__ == '__main__':
    main()
