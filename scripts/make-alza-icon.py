#!/usr/bin/env python3

from __future__ import annotations

import io
import pathlib
import re
from urllib.parse import urljoin

from curl_cffi import requests
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "alza-icon.png"
BASE = "https://www.alza.cz/"

SESSION = requests.Session(impersonate="chrome")
HEADERS = {"referer": BASE}


def discover_links() -> list[tuple[int, str]]:
    cands: list[tuple[int, str]] = []
    try:
        r = SESSION.get(BASE, timeout=25)
        r.raise_for_status()
        html = r.text
    except Exception as e:
        print(f"[warn] homepage se nepovedlo nacist: {e}")
        return cands

    for m in re.finditer(r"<link\b[^>]*>", html, re.I):
        tag = m.group(0)
        rel = re.search(r'rel=["\']([^"\']+)["\']', tag, re.I)
        href = re.search(r'href=["\']([^"\']+)["\']', tag, re.I)
        if not rel or not href:
            continue
        relv = rel.group(1).lower()
        if "icon" not in relv or "mask" in relv:
            continue
        ctype = re.search(r'type=["\']([^"\']+)["\']', tag, re.I)
        if ctype and "svg" in ctype.group(1).lower():
            continue
        url = href.group(1).replace("&amp;", "&")
        if url.startswith("data:"):
            continue
        size = 0
        sm = re.search(r'sizes=["\']([^"\']+)["\']', tag, re.I)
        if sm:
            for part in sm.group(1).split():
                wh = re.match(r"(\d+)x(\d+)", part)
                if wh:
                    size = max(size, int(wh.group(1)) * int(wh.group(2)))
        score = 10_000 if "apple-touch" in relv else (1_000 if relv == "icon" else 500)
        if size:
            score += size
        cands.append((score, urljoin(BASE, url)))
    cands.sort(reverse=True)
    uniq: list[tuple[int, str]] = []
    seen: set[str] = set()
    for score, url in cands:
        if url not in seen:
            seen.add(url)
            uniq.append((score, url))
    return uniq


def convert(data: bytes) -> tuple[bytes, str, tuple[int, int]]:
    im = Image.open(io.BytesIO(data))
    fmt = im.format or "?"
    if fmt == "ICO":
        sizes = im.info.get("sizes")
        print(f"      (ICO velikosti: {sorted(sizes) if sizes else '?'})")
        if sizes:
            try:
                im.size = max(sizes, key=lambda s: s[0] * s[1])
            except Exception as e:
                print(f"      [warn] nelze vybrat vetsi ICO velikost: {e}")
    im.load()
    im = im.convert("RGBA")
    if max(im.size) > 256:
        im.thumbnail((256, 256), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue(), fmt, im.size


def fetch_and_convert() -> tuple[bytes, str, str, tuple[int, int]] | None:
    urls = [u for _, u in discover_links()]
    for guess in ("apple-touch-icon.png", "apple-touch-icon-precomposed.png", "favicon.ico"):
        urls.append(urljoin(BASE, guess))
    seen: set[str] = set()
    best: tuple[bytes, str, str, tuple[int, int]] | None = None
    for url in urls:
        if url in seen or url.lower().endswith(".svg"):
            continue
        seen.add(url)
        try:
            r = SESSION.get(url, timeout=25, headers=HEADERS)
            if r.status_code != 200 or not r.content:
                print(f"[miss] {url} -> HTTP {r.status_code}")
                continue
            ctype = r.headers.get("content-type", "")
            if "svg" in ctype or r.content[:5] == b"<?xml":
                print(f"[skip] {url} je SVG")
                continue
            png, fmt, size = convert(r.content)
            print(f"[ok]   {url}: {fmt} {size[0]}x{size[1]} -> PNG {len(png)} B")
            if best is None or size[0] * size[1] > best[3][0] * best[3][1]:
                best = (png, url, fmt, size)
        except Exception as e:
            print(f"[miss] {url} -> {e}")
    return best


def main() -> int:
    print(f"Kandidati z {BASE}:")
    for score, url in discover_links():
        print(f"  [{score:>6}] {url}")

    result = fetch_and_convert()
    if result is None:
        print("Nepovedlo se ziskat zadnou pouzitelnou ikonu.")
        return 1
    png, url, fmt, size = result
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(png)
    print(f"\nOK: zdroj {url}")
    print(f"    {fmt} -> PNG {size[0]}x{size[1]}, {len(png)} B -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
