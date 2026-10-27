"""Parse an @aniplus channel post into a normalised anime record.

The channel posts contain *literal* Markdown links (not just Telegram entities),
which makes parsing stable and independent of UTF-16 entity offsets.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any, Iterable

from common import FA2EN, norm_fa, quality_key
from genres import normalize_genres
from quality import normalize_record

EPISODE_RE = re.compile(r"^\s*قسمت\s*([0-9۰-۹٠-٩]+)\s*[:：]\s*(.+)$")
MD_LINK_RE = re.compile(r"\[([^\]\n]{1,60})\]\(\s*(https?://[^)\s]+)\s*\)")
MINI_RE = re.compile(r"(?:t\.me|telegram\.me)/(?:AniPlusMiniBot)\?start=(get_[0-9A-Za-z_]+)")


def _clean(value: str) -> str:
    value = (value or "").replace("\u200f", "").replace("\u200e", "").strip()
    value = re.sub(r"^\*+|\*+$", "", value).strip()
    return value


def _button_url(button: Any) -> str:
    if isinstance(button, dict):
        return str(button.get("url") or "")
    return str(getattr(button, "url", "") or "")


def _button_text(button: Any) -> str:
    if isinstance(button, dict):
        return str(button.get("t") or button.get("text") or "")
    return str(getattr(button, "text", "") or "")


def iter_buttons(buttons: Any) -> Iterable[tuple[str, str]]:
    if not buttons:
        return
    for row in buttons:
        cells = row if isinstance(row, (list, tuple)) else [row]
        for cell in cells:
            yield _button_text(cell), _button_url(cell)


def _field(flat: str, label: str) -> str:
    pattern = re.compile(rf"^\s*{re.escape(label)}\s*[:：]\s*(.+?)\s*$", re.MULTILINE)
    match = pattern.search(flat)
    return _clean(match.group(1)) if match else ""


def _to_int(value: str) -> int | None:
    if not value:
        return None
    match = re.search(r"[0-9]+", value.translate(FA2EN))
    return int(match.group()) if match else None


def _to_float(value: str) -> float | None:
    if not value:
        return None
    match = re.search(r"[0-9]+(?:\.[0-9]+)?", value.translate(FA2EN))
    if not match:
        return None
    try:
        return float(match.group())
    except ValueError:
        return None


def _norm_quality(label: str) -> str:
    value = _clean(label).lower()
    value = value.replace("×", "x").replace(" ", " ").strip()
    value = re.sub(r"\s+", " ", value)
    if value in {"4k", "uhd"}:
        return "4k"
    return value


def _status(raw: str) -> str:
    flat = norm_fa(raw).replace(" ", "")
    if "پایان" in flat or "تمام" in flat:
        return "پایان یافته"
    if "زودی" in flat or "آینده" in flat:
        return "به‌زودی"
    return "در حال پخش"


def _type(raw: str) -> str:
    flat = norm_fa(raw)
    if "فیلم" in flat:
        return "فیلم"
    if any(word in flat for word in ("ova", "اسپشال", "ویژه")):
        return "OVA"
    return "سریال"


def _format(raw: str) -> str:
    """Keep AniPlus' broadcast format (TV, ONA, OVA, film...)."""
    flat = norm_fa(raw).upper()
    if "ONA" in flat:
        return "ONA"
    if "OVA" in flat:
        return "OVA"
    if "فیلم" in flat or "MOVIE" in flat:
        return "MOVIE"
    if "SPECIAL" in flat or "اسپشال" in flat or "ویژه" in flat:
        return "SPECIAL"
    if "TV" in flat or "تی وی" in flat:
        return "TV"
    return ""


def _age(raw: str) -> str:
    flat = norm_fa(raw)
    numbers = re.findall(r"[0-9]+", flat.translate(FA2EN))
    for number in numbers:
        value = int(number)
        if value >= 17:
            return "+18"
        if value >= 15:
            return "+16"
        if value >= 12:
            return "+13"
    if "R" in flat or "r" == flat.strip():
        return "+18"
    return "+13"


def _season(raw: str, season_en: str) -> tuple[str, int | None]:
    flat = norm_fa(raw)
    season = ""
    for name in ("بهار", "تابستان", "پاییز", "زمستان"):
        if name in flat:
            season = name
            break
    if not season:
        low = season_en.lower()
        season = (
            "بهار" if "spring" in low else
            "تابستان" if "summer" in low else
            "پاییز" if "fall" in low or "autumn" in low else
            "زمستان" if "winter" in low else
            ""
        )
    year = None
    match = re.search(r"(?:19|20)[0-9]{2}", season_en)
    if match:
        year = int(match.group())
    else:
        jalali = _to_int(flat)
        if jalali and 1300 <= jalali <= 1500:
            year = jalali + 621
    return season, year


def parse_post(
    post_id: int,
    text: str,
    date: Any,
    buttons: Any = None,
    *,
    photo_url: str = "",
) -> dict[str, Any] | None:
    text = text or ""
    if "🎥" not in text or "لینک" not in text:
        return None
    if "دانلود" not in text:
        return None

    flat = norm_fa(text)

    # --- main title + cover -------------------------------------------------
    title_match = re.search(r"\[🎥\]\(\s*([^)\n]+?)\s*\)\s*([^\n]+)", text)
    if not title_match:
        return None
    cover_url = title_match.group(1).strip() or photo_url
    main_title = _clean(title_match.group(2))
    main_title = re.sub(r"^\s*[-–—]\s*", "", main_title).strip()
    if main_title.startswith("http"):
        return None

    hashtag_match = re.search(r"^\s*#([^\s#]+)", text, re.MULTILINE)
    hashtag = hashtag_match.group(1).strip() if hashtag_match else ""

    # --- names block --------------------------------------------------------
    names_block = text
    if "دیگر عنوان" in names_block:
        names_block = names_block.split("دیگر عنوان", 1)[1]
    else:
        names_block = text
    title_fa = _field(names_block, "نام فارسی")
    title_en = _field(names_block, "نام انگلیسی")
    title_original = _field(names_block, "نام اصلی")
    title_ja = _field(names_block, "نام ژاپنی")

    def usable(value: str) -> str:
        value = _clean(value)
        if not value or "نامشخص" in value or value in {"-", "—", "?"}:
            return ""
        return value

    title_fa = usable(title_fa)
    title_en = usable(title_en)
    title_original = usable(title_original)
    title_ja = usable(title_ja)
    if not title_en:
        title_en = title_original or main_title
    if not title_fa:
        title_fa = title_en
    if not title_original:
        title_original = main_title
    if not title_ja:
        title_ja = title_original

    # --- synopsis -----------------------------------------------------------
    synopsis = ""
    match = re.search(
        r"📜\s*خلاصه داستان\s*:?\s*\*{0,3}\s*\n+(.*?)(?=\n\s*\*{0,3}\s*(?:⭐|📖|📥)|\Z)",
        text,
        re.DOTALL,
    )
    if match:
        synopsis = re.sub(r"\n{3,}", "\n\n", match.group(1)).strip()
        synopsis = _clean(synopsis)

    # --- scores -------------------------------------------------------------
    score_aniplus = _to_float(
        (re.search(r"انی\s*پلاس\s*[:：]\s*([^\n]+)", flat) or [None, ""])[1]  # type: ignore[index]
    )
    score_mal = _to_float(
        (re.search(r"مای\s*انیمه\s*لیست\s*[:：]\s*([^\n]+)", flat) or [None, ""])[1]  # type: ignore[index]
    )

    # --- info block ---------------------------------------------------------
    info = flat
    if "اطلاعات تکمیلی" in info:
        info = info.split("اطلاعات تکمیلی", 1)[1]
    if "لینک" in info:
        info = re.split(r"📥\s*لینک", info, maxsplit=1)[0]
    info_orig = text
    if "اطلاعات تکمیلی" in info_orig:
        info_orig = info_orig.split("اطلاعات تکمیلی", 1)[1]
    if "📥" in info_orig:
        info_orig = info_orig.split("📥", 1)[0]
    type_raw = _field(info, "نوع")
    season_raw = _field(info, "فصل")
    season_en = _field(info, "فصل (میلادی)")
    status_raw = _field(info, "وضعیت")
    start_raw = _field(info, "پخش از")
    declared_raw = _field(info, "تعداد قسمت")
    duration_raw = _field(info, "زمان هر قسمت")
    age_raw = _field(info, "رده سنی")
    source_raw = _field(info, "منبع ساخت")
    producers = _field(info, "تهیه‌کنندگان") or _field(info, "تهیه کنندگان")
    studio = _field(info, "استودیو سازنده")
    genres_raw = _field(info_orig, "ژانرها") or _field(info, "ژانرها")

    genre_list = normalize_genres(genres_raw)

    season, year = _season(season_raw, season_en)
    anime_type = _type(type_raw)
    declared = _to_int(declared_raw)
    if declared is not None and declared > 5000:
        declared = None
    if anime_type == "فیلم":
        declared = 1

    # --- watch url / aniplus id --------------------------------------------
    watch_url = ""
    aniplus_id = ""
    for label, url in iter_buttons(buttons):
        if "/anime/" in url and "aniplus.my" in url:
            watch_url = url
            match = re.search(r"/anime/(\d+)/", url)
            if match:
                aniplus_id = match.group(1)
            break
    if not aniplus_id:
        match = re.search(r"aniplus\.my/anime/(\d+)/", text)
        if match:
            aniplus_id = match.group(1)
    if not aniplus_id:
        match = re.search(r"anime_(\d+)_comments", text)
        if match:
            aniplus_id = match.group(1)
    if not watch_url and aniplus_id:
        watch_url = f"https://aniplus.my/anime/{aniplus_id}/"

    # --- download links -----------------------------------------------------
    section = ""
    match = re.search(r"📥\s*لینک\s*های\s*دانلود\s*:?\s*\*{0,3}\s*\n+(.*)$", text, re.DOTALL)
    if match:
        section = match.group(1)

    episodes: dict[str, dict[str, str]] = {}
    current_ep: int | None = None
    for raw_line in section.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        ep_match = EPISODE_RE.match(line)
        if ep_match:
            current_ep = _to_int(ep_match.group(1))
            line = ep_match.group(2)
        elif current_ep is None:
            # A movie / single-file post has quality links without an episode line.
            if anime_type != "فیلم" and not re.search(r"start=get_", line):
                continue
            current_ep = 1
        if current_ep is None:
            continue
        for label, url in MD_LINK_RE.findall(line):
            if "start=get_" not in url:
                continue
            quality = _norm_quality(label)
            if not quality or quality in {"دانلود", "لینک"}:
                continue
            bucket = episodes.setdefault(str(current_ep), {})
            bucket.setdefault(quality, url)

    if not episodes:
        return None

    if date is None:
        date_iso = ""
    elif isinstance(date, dt.datetime):
        date_iso = date.isoformat()
    else:
        date_iso = str(date)

    if not season:
        season = "نامشخص"

    return normalize_record({
        "postId": int(post_id),
        "date": date_iso,
        "hashtag": hashtag,
        "animeId": aniplus_id,
        "watchUrl": watch_url,
        "titleMain": main_title,
        "titleEn": title_en,
        "titleFa": title_fa,
        "titleOriginal": title_original,
        "titleJa": title_ja,
        "synopsis": synopsis,
        "type": anime_type,
        "format": _format(type_raw),
        "status": _status(status_raw),
        "season": season,
        "seasonRaw": season_raw,
        "seasonEn": season_en,
        "year": year,
        "startDate": start_raw,
        "declaredEpisodes": declared,
        "durationRaw": duration_raw,
        "ageRating": _age(age_raw),
        "ageRaw": age_raw,
        "sourceMaterial": source_raw,
        "producers": producers,
        "studio": studio or "—",
        "genres": genre_list[:8],
        "scoreAniplus": score_aniplus,
        "scoreMal": score_mal,
        "coverUrl": cover_url,
        "episodes": episodes,
        "postUrl": f"https://t.me/aniplus/{post_id}",
    })


def episode_count(record: dict[str, Any]) -> int:
    nums = [int(k) for k in record.get("episodes", {}).keys()]
    return max(nums) if nums else 0
