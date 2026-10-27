"""Shared catalogue/UI genre vocabulary; no network or source-state mutation."""
import json
from pathlib import Path
import re
import unicodedata

TAXONOMY = json.loads((Path(__file__).resolve().parents[2] / "src/lib/genre-taxonomy.json").read_text())


def clean(value):
    value = unicodedata.normalize("NFKC", value).translate(str.maketrans("يىك", "ییک"))
    value = re.sub(r"[\u064b-\u065f\u0670\u0640\u200b\u200e\u200f\u202a-\u202e\ufeff]", "", value)
    value = re.sub(r"[_\u200c\u200d-]+", " ", value)
    return re.sub(r"\s+", " ", re.sub(r"[*`]", "", value)).strip()


NAMES = {clean(name): name for name in TAXONOMY["names"]}
NAMES.update({clean(alias): name for alias, name in TAXONOMY["aliases"].items()})
IGNORED = {clean(name) for name in TAXONOMY["ignored"]}
PHRASES = sorted(NAMES, key=len, reverse=True)


def normalize_genres(values):
    output = []
    for raw in [values] if isinstance(values, str) else values or []:
        if not isinstance(raw, str):
            continue
        for part in re.split(r"[#＃,،;؛|/\n\r]+", raw):
            value = clean(part)
            if not value or value.lower() in IGNORED:
                continue
            if value in NAMES:
                found = [NAMES[value]]
            else:
                rest, found = value, []
                while rest:
                    phrase = next((name for name in PHRASES if rest == name or rest.startswith(name + " ")), None)
                    if phrase is None:
                        break
                    found.append(NAMES[phrase])
                    rest = rest[len(phrase):].strip()
                if rest:
                    found = [value] if len(value) <= 60 and all(c.isalnum() or c == " " for c in value) else []
            for name in found:
                if name not in output:
                    output.append(name)
    return output
