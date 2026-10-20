#!/usr/bin/env python3

from __future__ import annotations

import io
import pathlib

import resvg_py
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "emoji"
SIZE = 128

DARK = "#171717"
WHITE = "#ffffff"

STAR = "M64 26 L73.2 51.4 L100.2 52.4 L79 69.1 L86.3 95.1 L64 80 L41.7 95.1 L49 69.1 L27.8 52.4 L54.8 51.4 Z"

VOUCHER = (
    "M17,9.667C17.001,9.366 17.084,9.07 17.239,8.812C17.395,8.553 17.617,8.342 17.883,8.2C18.128,8.054 "
    "18.329,7.846 18.466,7.597C18.604,7.348 18.673,7.067 18.666,6.783L18.666,4.667C18.665,4.225 18.489,3.802 "
    "18.177,3.49C17.865,3.178 17.442,3.002 17,3L3.667,3C3.45,3 3.234,3.042 3.032,3.126C2.831,3.209 2.648,3.331 "
    "2.494,3.485C2.34,3.639 2.218,3.822 2.134,4.023C2.051,4.224 2.008,4.44 2.008,4.658L2.008,6.783C1.999,7.067 "
    "2.067,7.347 2.205,7.595C2.343,7.843 2.546,8.049 2.791,8.191C3.056,8.336 3.277,8.549 3.431,8.809C3.585,9.068 "
    "3.666,9.364 3.666,9.666C3.667,9.968 3.585,10.264 3.429,10.522C3.273,10.781 3.05,10.992 2.783,11.133C2.539,"
    "11.279 2.338,11.487 2.201,11.736C2.063,11.985 1.994,12.266 2,12.55L2,14.667C2.002,15.109 2.178,15.532 2.49,"
    "15.844C2.802,16.157 3.226,16.333 3.667,16.334L17,16.334C17.442,16.333 17.865,16.157 18.178,15.844C18.49,"
    "15.532 18.666,15.109 18.667,14.667L18.667,12.55C18.674,12.266 18.605,11.985 18.467,11.736C18.33,11.487 "
    "18.129,11.279 17.884,11.133C17.618,10.991 17.396,10.78 17.24,10.522C17.084,10.264 17.002,9.968 17,9.667Z"
    "M12.417,13.084L10.333,11.75L8.25,13.092C8.18,13.136 8.097,13.158 8.014,13.155C7.93,13.152 7.85,13.124 "
    "7.783,13.075C7.715,13.026 7.664,12.957 7.636,12.879C7.608,12.8 7.604,12.715 7.625,12.634L8.25,10.234L6.333,"
    "8.667C6.268,8.613 6.221,8.542 6.197,8.461C6.174,8.38 6.175,8.294 6.201,8.213C6.227,8.133 6.277,8.063 6.344,"
    "8.011C6.411,7.96 6.491,7.93 6.575,7.925L9.042,7.783L9.942,5.491C9.973,5.413 10.027,5.347 10.096,5.3C10.165,"
    "5.253 10.246,5.228 10.33,5.228C10.413,5.228 10.495,5.253 10.564,5.3C10.633,5.347 10.687,5.413 10.717,5.491"
    "L11.617,7.791L14.084,7.933C14.168,7.939 14.248,7.969 14.314,8.021C14.38,8.073 14.43,8.143 14.456,8.222"
    "C14.482,8.302 14.483,8.388 14.46,8.468C14.437,8.549 14.39,8.621 14.326,8.675L12.409,10.242L13.042,12.625"
    "C13.065,12.706 13.062,12.792 13.035,12.872C13.007,12.951 12.956,13.021 12.888,13.07C12.82,13.12 12.739,"
    "13.148 12.655,13.15C12.571,13.152 12.488,13.129 12.417,13.083L12.417,13.084Z"
)


CASHBACK = (
    "M14.392 5.742C15.6898 5.99352 16.8595 6.68881 17.7007 7.7086C18.5418 8.72838 19.0018 10.0091 19.0018 11.331C19.0018 12.6529 18.5418 13.9336 17.7007 14.9534C16.8595 15.9732 15.6898 16.6685 14.392 16.92C15.373 16.3535 16.1876 15.5388 16.7539 14.5577C17.3203 13.5767 17.6184 12.4638 17.6184 11.331C17.6184 10.1982 17.3203 9.08535 16.7539 8.10428C16.1876 7.12322 15.373 6.3085 14.392 5.742ZM6.20001 13.276L7.81301 11.069C8.04404 10.7518 8.16835 10.3694 8.16801 9.977C8.17195 9.56728 8.03668 9.16835 7.78435 8.84553C7.53201 8.52271 7.17756 8.29511 6.77901 8.2C7.24841 7.46506 7.88585 6.85228 8.63871 6.41221C9.39158 5.97214 10.2383 5.71739 11.109 5.669H11.146C11.2273 5.66567 11.3093 5.664 11.392 5.664C12.1171 5.65983 12.8356 5.80264 13.504 6.08382C14.1724 6.36501 14.7769 6.77872 15.281 7.3C16.3262 8.38199 16.9133 9.82567 16.92 11.33C16.9387 12.8149 16.3668 14.2464 15.3301 15.3097C14.2935 16.373 12.8769 16.981 11.392 17C10.6662 17.0042 9.94699 16.8611 9.27803 16.5794C8.60906 16.2977 8.00419 15.8832 7.50001 15.361C6.92143 14.7678 6.47796 14.0566 6.20001 13.276ZM12.082 13.457V9.2H10.7L10.011 10.617H10.7V13.452L12.082 13.457ZM2.79001 9.371C2.7832 7.44757 3.53096 5.59818 4.87268 4.22C6.2144 2.84181 8.04309 2.04476 9.96601 2V4.456C8.68295 4.49075 7.46366 5.02292 6.56573 5.94006C5.66781 6.85721 5.16158 8.0875 5.15401 9.371H6.40001C6.55844 9.37363 6.7094 9.43883 6.81994 9.55237C6.93048 9.6659 6.99161 9.81855 6.99001 9.977C6.99024 10.1078 6.94892 10.2352 6.87201 10.341L4.46701 13.632C4.42161 13.6953 4.36391 13.7489 4.29737 13.7894C4.23083 13.8299 4.1568 13.8566 4.0797 13.8679C4.00261 13.8792 3.92403 13.8749 3.84866 13.8551C3.77328 13.8354 3.70266 13.8006 3.64101 13.753C3.59616 13.7184 3.55643 13.6777 3.52301 13.632L1.11801 10.341C1.02383 10.2118 0.983498 10.051 1.00551 9.89266C1.02752 9.73429 1.11016 9.59064 1.23601 9.492C1.3374 9.41367 1.46188 9.37113 1.59001 9.371H2.79001Z"
)


SCRAPPAGE = (
    "M12.2852 14.8422H14.8452C14.9801 14.8398 15.1133 14.8106 15.2369 14.7564C15.3605 14.7021 15.472 14.6239 15.5652 14.5262L16.1252 13.7372C16.1963 13.6199 16.2404 13.4882 16.2542 13.3517C16.2681 13.2153 16.2513 13.0774 16.2052 12.9482L14.8452 10.6592L16.2052 9.87021L17.5652 12.1592C17.7956 12.5333 17.904 12.9698 17.8753 13.4082C17.8467 13.8466 17.6824 14.2653 17.4052 14.6062L16.8452 15.3952C16.6144 15.7098 16.3135 15.9663 15.9663 16.1444C15.6192 16.3225 15.2353 16.4173 14.8452 16.4212H12.2852V18.0002L9.88519 15.6322L12.2852 13.2642V14.8422ZM12.7852 7.27021L11.4852 5.05321C11.4092 4.90753 11.2941 4.78597 11.1527 4.70222C11.0114 4.61847 10.8494 4.57587 10.6852 4.57921H9.08519C8.92092 4.57587 8.75899 4.61847 8.61765 4.70222C8.4763 4.78597 8.36115 4.90753 8.28518 5.05321L7.00519 7.18421L5.64519 6.39521L6.92519 4.26321C7.137 3.87673 7.44985 3.55507 7.8303 3.33262C8.21075 3.11016 8.6445 2.99526 9.08519 3.00021H10.6852C11.1368 2.99443 11.5819 3.10823 11.9753 3.33004C12.3687 3.55186 12.6964 3.87381 12.9252 4.26321L14.2252 6.40721L15.5622 5.60721L14.7622 8.84421L11.4852 8.05321L12.7852 7.27021ZM5.01519 10.7272L3.71519 12.9472C3.66905 13.0764 3.65229 13.2143 3.66613 13.3507C3.67997 13.4872 3.72405 13.6189 3.79519 13.7362L4.35519 14.5252C4.35519 14.6832 4.67519 14.8412 4.99519 14.8412H8.28518V16.4202H5.00519C4.61339 16.4254 4.22627 16.3347 3.87764 16.1558C3.52901 15.977 3.22947 15.7155 3.00519 15.3942L2.44519 14.6052C2.18609 14.2559 2.0332 13.8393 2.00482 13.4053C1.97644 12.9713 2.07379 12.5383 2.28519 12.1582L3.68519 9.88321L2.28519 9.00021L5.56519 8.28921L6.28519 11.5262L5.01519 10.7272Z"
)


def disc(color: str, glyph: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 128 128">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity=".10"/>'
        f"</linearGradient></defs>"
        f'<circle cx="64" cy="64" r="64" fill="{color}"/>'
        f'<circle cx="64" cy="64" r="64" fill="url(#g)"/>'
        f"{glyph}</svg>"
    )


def star(fill: str) -> str:
    return f'<path d="{STAR}" fill="{fill}" stroke="{fill}" stroke-width="6" stroke-linejoin="round"/>'


def arrow_ring(color: str, rot: int, cx: float = 64, cy: float = 64, r: float = 28) -> str:
    return (
        f'<g transform="rotate({rot} {cx} {cy})" fill="none" stroke="{color}" stroke-width="10" '
        f'stroke-linecap="round" stroke-linejoin="round">'
        f'<path d="M{cx - r} {cy} A{r} {r} 0 0 1 {cx + r * 0.5} {cy - r * 0.866}"/>'
        f'<path d="M{cx + r * 0.5 + 2} {cy - r * 0.866 - 14} L{cx + r * 0.5 + 2} {cy - r * 0.866 + 2} '
        f'L{cx + r * 0.5 - 14} {cy - r * 0.866 + 4}" /></g>'
    )


ICONS: dict[str, str] = {
    "alza_gold": disc("#ffd500", star(DARK)),
    "alza_silver": disc("#c2c2c2", star(DARK)),
    "alza_bronze": disc("#d2822d", star(WHITE)),
    "alza_isic": disc("#3cba9c", star(WHITE)),
    "alza_b2b": disc("#3a349f", star(WHITE)),
    "alza_basic": disc("#3cba9c", star(WHITE)),
    "alza_promo": disc(
        "#91b7ff",
        '<g transform="translate(64 64) scale(1.08) translate(-64 -64)" fill="none" stroke="#14316b" stroke-width="10" stroke-linecap="round">'
        '<circle cx="44" cy="44" r="11"/><circle cx="84" cy="84" r="11"/><path d="M88 34 L40 94"/></g>',
    ),
    "alza_sale": disc(
        "#c51718",
        '<g transform="translate(64 64) scale(1.08) translate(-64 -64)" fill="none" stroke="#fce649" stroke-width="10" stroke-linecap="round">'
        '<circle cx="44" cy="44" r="11"/><circle cx="84" cy="84" r="11"/><path d="M88 34 L40 94"/></g>',
    ),
    "alza_price": disc(
        "#c51718",
        f'<g transform="translate(64 64) scale(1.15) translate(-66 -64) rotate(-45 64 64)"><path d="M30 50 Q30 44 36 44 H78 L102 64 L78 84 H36 Q30 84 30 78 Z" '
        f'fill="{WHITE}" stroke="{WHITE}" stroke-width="4" stroke-linejoin="round"/>'
        f'<circle cx="46" cy="64" r="6.5" fill="#c51718"/></g>',
    ),
    "alza_coupon": disc(
        "#f9e8e8",
        f'<g transform="translate(64 64) scale(5.1) translate(-10 -10)"><path d="{VOUCHER}" '
        f'fill="#c51718" fill-rule="evenodd" transform="translate(-0.333908 0.333001)"/></g>',
    ),
    "alza_cashback": disc(
        "#689700",
        f'<g transform="translate(64 64) scale(4.6) translate(-10 -9.6)"><path d="{CASHBACK}" '
        f'fill="{WHITE}" fill-rule="evenodd"/></g>',
    ),
    "alza_tradein": disc(
        "#f2fde5",
        f'<g transform="translate(64 64) scale(5) translate(-10 -10.5)"><path d="{SCRAPPAGE}" '
        f'fill="#4f7a0a" fill-rule="evenodd"/></g>',
    ),
}


def render(svg: str) -> Image.Image:
    png = resvg_py.svg_to_bytes(svg_string=svg, width=SIZE * 4, height=SIZE * 4)
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)


def on_white_disc(src: pathlib.Path, fill: float = 0.74, bg: tuple = (255, 255, 255, 255)) -> Image.Image:
    S = SIZE * 4
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(base).ellipse((0, 0, S - 1, S - 1), fill=bg)
    ico = Image.open(src).convert("RGBA")
    inner = int(S * fill)
    ico = ico.resize((inner, inner), Image.LANCZOS)
    base.alpha_composite(ico, ((S - inner) // 2, (S - inner) // 2))
    return base.resize((SIZE, SIZE), Image.LANCZOS)


def alza_favicon() -> Image.Image:
    S = SIZE * 4
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(base).ellipse((0, 0, S - 1, S - 1), fill=(255, 255, 255, 255))
    ico = Image.open(ROOT / "assets" / "alza-icon.png").convert("RGBA")
    inner = int(S * 0.72)
    ico = ico.resize((inner, inner), Image.LANCZOS)
    base.alpha_composite(ico, ((S - inner) // 2, (S - inner) // 2))
    return base.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, svg in ICONS.items():
        render(svg).save(OUT / f"{name}.png", optimize=True)
    alza_favicon().save(OUT / "alza_logo.png", optimize=True)
    on_white_disc(ROOT / "assets" / "src" / "alzaplus.png", bg=(255, 241, 224, 255)).save(OUT / "alza_plus.png", optimize=True)

    small = OUT / "small"
    small.mkdir(exist_ok=True)
    for f in OUT.glob("alza_*.png"):
        Image.open(f).resize((48, 48), Image.LANCZOS).save(small / f.name, optimize=True)

    names = list(ICONS) + ["alza_logo", "alza_plus"]
    sheet = Image.new("RGBA", (len(names) * 140 + 10, 150), (49, 51, 56, 255))
    for i, n in enumerate(names):
        sheet.alpha_composite(Image.open(OUT / f"{n}.png"), (10 + i * 140, 10))
    sheet.save(OUT / "_preview.png")
    print(f"ok: {len(names)} ikon -> {OUT}")


if __name__ == "__main__":
    main()
