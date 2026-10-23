"""Cover download + local cover/banner generation."""
from __future__ import annotations

import io
import re
import ssl
import urllib.error
import urllib.request
from pathlib import Path

from common import PUBLIC_COVERS

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
MAX_BYTES = 25 * 1024 * 1024


def safe_key(value: str) -> str:
    key = re.sub(r"[^a-zA-Z0-9_-]+", "", value or "")
    return key[:60] or "anime"


def _fetch(url: str, timeout: int = 30) -> bytes | None:
    url = (url or "").strip()
    if not url.startswith("http"):
        return None
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Referer": "https://t.me/aniplus",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read(MAX_BYTES + 1)
    except ssl.SSLError:
        context = ssl._create_unverified_context()
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
                data = response.read(MAX_BYTES + 1)
        except Exception:
            return None
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None
    if len(data) > MAX_BYTES or len(data) < 1024:
        return None
    return data


def _thumb_path(cover_path: Path) -> Path:
    return cover_path.with_name(f"{cover_path.stem}-thumb.webp")


def _write_thumb(cover_path: Path) -> None:
    """Build the small WebP used by dense card grids."""
    try:
        from PIL import Image
    except Exception:
        return
    try:
        thumb = Image.open(cover_path).convert("RGB")
        thumb.thumbnail((480, 720), Image.LANCZOS)
        thumb.save(_thumb_path(cover_path), "WEBP", quality=78, method=6)
    except Exception:
        pass


def _build_assets(raw: bytes, cover_path: Path, banner_path: Path) -> bool:
    try:
        from PIL import Image, ImageEnhance, ImageFilter, ImageOps
    except Exception:
        cover_path.write_bytes(raw)
        banner_path.write_bytes(raw)
        return True

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
        image = ImageOps.exif_transpose(image).convert("RGB")
        width, height = image.size
        if width < 80 or height < 80:
            return False

        cover = image.copy()
        cover.thumbnail((660, 990), Image.LANCZOS)
        cover.save(cover_path, "JPEG", quality=88, optimize=True, progressive=True)
        thumb = cover.copy()
        thumb.thumbnail((480, 720), Image.LANCZOS)
        thumb.save(_thumb_path(cover_path), "WEBP", quality=78, method=6)

        W, H = 1600, 900
        portrait = height > width * 1.06
        if portrait:
            background = ImageOps.fit(image, (W, H), Image.LANCZOS, centering=(0.5, 0.24))
            background = background.filter(ImageFilter.GaussianBlur(30))
            background = ImageEnhance.Brightness(background).enhance(0.55)
            background = ImageEnhance.Color(background).enhance(0.85)

            poster = image.copy()
            poster.thumbnail((760, 900), Image.LANCZOS)
            px = 120
            py = (H - poster.height) // 2
            shadow = Image.new("RGB", (poster.width + 40, poster.height + 40), (0, 0, 0))
            shadow = shadow.filter(ImageFilter.GaussianBlur(18))
            background.paste(shadow, (px - 20, py - 12))
            background.paste(poster, (px, py))
        else:
            background = ImageOps.fit(image, (W, H), Image.LANCZOS, centering=(0.5, 0.42))
            background = ImageEnhance.Brightness(background).enhance(0.78)
            background = ImageEnhance.Color(background).enhance(0.94)

        # Darken the right side for the glass info card (RTL layout).
        mask = Image.new("L", (W, 1), 0)
        mask_px = mask.load()
        for x in range(W):
            t = max(0.0, (x - W * 0.40) / (W * 0.60))
            mask_px[x, 0] = int(180 * (t ** 1.35))
        overlay = Image.new("RGB", (W, H), (2, 2, 5))
        background = Image.composite(overlay, background, mask.resize((W, H), Image.BILINEAR))

        # A little extra shade at the bottom.
        bottom = Image.new("L", (1, H), 0)
        bottom_px = bottom.load()
        for y in range(H):
            t = max(0.0, (y - H * 0.55) / (H * 0.45))
            bottom_px[0, y] = int(120 * (t ** 1.2))
        background = Image.composite(Image.new("RGB", (W, H), (2, 2, 5)), background, bottom.resize((W, H)))

        background.save(banner_path, "JPEG", quality=85, optimize=True, progressive=True)
        return True
    except Exception:
        try:
            cover_path.write_bytes(raw)
            banner_path.write_bytes(raw)
        except OSError:
            return False
        return True


def ensure_cover(key: str, url: str) -> tuple[str, str] | None:
    """Download and build assets. Returns (cover_url, banner_url) or None."""
    key = safe_key(key)
    cover_path = PUBLIC_COVERS / f"{key}.jpg"
    banner_path = PUBLIC_COVERS / f"{key}-banner.jpg"
    if cover_path.exists() and cover_path.stat().st_size > 2000 and banner_path.exists():
        if not _thumb_path(cover_path).exists():
            _write_thumb(cover_path)
        version = int(cover_path.stat().st_mtime)
        return f"/covers/aniplus/{key}.jpg?v={version}", f"/covers/aniplus/{key}-banner.jpg?v={version}"
    raw = _fetch(url)
    if not raw:
        return None
    if not _build_assets(raw, cover_path, banner_path):
        return None
    if not cover_path.exists() or cover_path.stat().st_size < 1000:
        return None
    version = int(cover_path.stat().st_mtime)
    return f"/covers/aniplus/{key}.jpg?v={version}", f"/covers/aniplus/{key}-banner.jpg?v={version}"
