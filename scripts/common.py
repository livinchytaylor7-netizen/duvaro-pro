"""公共配置与读写工具。"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MATCHES = DATA / "matches.json"
META = DATA / "meta.json"

LEAGUES = {
    "laliga": {"sport": "soccer_spain_la_liga", "name": "西甲"},
    "seriea": {"sport": "soccer_italy_serie_a", "name": "意甲"},
}

# 市场基准优先用 Pinnacle；其余仅用于胜平负价格对比
MARKET_BOOK = "pinnacle"
COMPARE_BOOKS = [
    "pinnacle", "paddypower", "boylesports", "betfair_ex_uk", "williamhill",
    "skybet", "ladbrokes_uk", "betvictor", "unibet_uk", "smarkets",
]

ODDS_API = "https://api.the-odds-api.com/v4"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load(path, default):
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def redact(text):
    """把密钥从任何要保存的文本里抹掉（仓库是公开的）。"""
    for name in ("ODDS_API_KEY", "GEMINI_API_KEY"):
        v = (os.environ.get(name) or "").strip()
        if v and len(v) >= 8:
            text = text.replace(v, "***")
    text = re.sub(r"https://vertexaisearch\.cloud\.google\.com/[^\"\s]*", "", text)
    text = re.sub(r"\bAQ\.[A-Za-z0-9_\-]{20,}", "***", text)
    text = re.sub(r"\bAIza[0-9A-Za-z_\-]{30,}", "***", text)
    return re.sub(r"(apiKey|key)=[A-Za-z0-9._\-]{16,}", r"\1=***", text)


def save(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    text = redact(json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True))
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    tmp.replace(path)


def http_json(url, params=None, body=None, headers=None, timeout=60):
    """返回 (状态码, json 或文本, 响应头)。不抛异常，便于上层记录失败原因。"""
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    data = None
    hdrs = {"User-Agent": "duvaro-pro/1.0"}
    if headers:
        hdrs.update(headers)
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else None, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = raw[:500]
        return e.code, payload, dict(e.headers or {})
    except Exception as e:  # 网络错误
        return 0, str(e), {}


def log(meta, msg):
    line = f"{iso(now())} {msg}"
    print(line)
    meta.setdefault("log", []).append(line)
    meta["log"] = meta["log"][-200:]
