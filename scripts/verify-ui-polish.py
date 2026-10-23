"""HTTP/SSR smoke checks, not browser-based visual QA."""
import concurrent.futures
import json
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.cards = 0
        self.skip = 0
        self.text = []
        self.viewport = False
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "style"):
            self.skip += 1
        if tag == "article" and "group/card" in attrs.get("class", "").split():
            self.cards += 1
        if tag == "meta" and attrs.get("name") == "viewport":
            self.viewport = "width=device-width" in attrs.get("content", "")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if not self.skip:
            self.text.append(data)


base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3011").rstrip("/")
catalog = json.loads((Path(__file__).resolve().parents[1] / "src/lib/real-catalog.json").read_text())
sample = next(item for item in catalog if item["status"] == "در حال پخش" and item.get("episodeData"))
routes = ["/", "/browse", "/favorites", "/login", "/privacy", "/terms", "/admin", "/anime/" + sample["slug"]]


def get(route):
    with urllib.request.urlopen(base + route, timeout=60) as response:
        body = response.read()
        assert response.status == 200, (route, response.status)
        return route, body


pages = dict(concurrent.futures.ThreadPoolExecutor(max_workers=4).map(get, routes))
for route, body in pages.items():
    page = Page(body.decode())
    assert page.viewport, (route, "missing mobile viewport")
    print(route, "200", len(body), "bytes", page.cards, "poster cards")

archive = Page(pages["/browse"].decode())
assert archive.cards == 30, ("initial archive batch", archive.cards)
assert "نمایش" in "".join(archive.text)
detail = Page(pages["/anime/" + sample["slug"]].decode())
text = "".join(detail.text)
assert text.count(sample["synopsis"]) == 1, "synopsis must not repeat in the info panel"
assert "آخرین به‌روزرسانی" in text
assert "زمان انتشار هنوز اعلام نشده" in text or sample.get("nextEpisodeAt")
assert "پنل ادمین" not in "".join(Page(pages["/"].decode()).text), "public header exposed admin navigation"
assert "این بخش فقط برای حساب مدیر" not in "".join(Page(pages["/admin"].decode()).text), "admin must hydrate account before deciding access"

_, index_raw = get("/api/catalog-search")
index = json.loads(index_raw)
assert len(index) == len(catalog)
assert all(set(item) <= {"slug", "title", "titleEn", "year", "cover", "banner"} for item in index)
assert not any("episodeData" in item for item in index)
print("Search index:", len(index), "items;", len(index_raw), "bytes; no episode/download payload")
print("PASS: route, mobile viewport, archive batch, unique synopsis, dates and public search checks")
