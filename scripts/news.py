"""免费新闻源：Google 新闻 RSS（无需密钥）。为 AI 线提供每队最近 7 天的伤停、阵容新闻。"""
import re
from functools import lru_cache
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

RSS = "https://news.google.com/rss/search?{q}&hl=en-GB&gl=GB&ceid=GB:en"
TOPICS = '(injury OR injured OR suspended OR suspension OR lineup OR "team news" OR doubt OR return OR coach)'
PER_TEAM = 8


def _fetch(query):
    url = RSS.format(q=urllib.parse.urlencode({"q": query}))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 duvaro-pro"})
    with urllib.request.urlopen(req, timeout=30) as r:
        root = ET.fromstring(r.read())
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        src = it.find("source")
        source = (src.text or "").strip() if src is not None else ""
        site = src.get("url", "") if src is not None else ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        try:
            date = parsedate_to_datetime(it.findtext("pubDate")).strftime("%Y-%m-%d")
        except Exception:
            date = ""
        items.append({"title": title[:200], "source": source[:60],
                      "url": site if re.match(r"^https?://[^/]+/?$", site or "") else "", "date": date})
    return items


@lru_cache(maxsize=256)
def team_news(team):
    try:
        items = _fetch(f'"{team}" {TOPICS} when:7d')
    except Exception as e:  # 新闻源不可用时，AI 仍可只依据盘口给出“无调整”
        return [], str(e)[:200]
    seen, out = set(), []
    for x in sorted(items, key=lambda x: x["date"], reverse=True):
        key = x["title"].lower()[:80]
        if key in seen:
            continue
        seen.add(key)
        out.append(x)
        if len(out) >= PER_TEAM:
            break
    return out, None
