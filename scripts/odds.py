"""拉取赔率，计算盘口线。只在需要时调用接口，节省每月 500 次免费额度。

每次拉一个联赛：2 个市场（胜平负、大小球）× 2 个地区（uk、eu）= 4 次额度。
"""
import os
import statistics
from datetime import timedelta

import model
from common import (COMPARE_BOOKS, LEAGUES, MARKET_BOOK, ODDS_API, http_json, iso, log,
                    now, parse_iso)

WINDOW_H = 36          # 关注未来 36 小时内的比赛
REFRESH_H = 18         # 同一联赛两次刷新至少间隔 18 小时
DISCOVER_H = 72        # 联赛没有已知未来比赛时，最多 72 小时探查一次
RESERVE = 40           # 剩余额度低于此值时，只补缺失的盘口，不做刷新


def _h2h(book, home, away):
    for mk in book.get("markets", []):
        if mk["key"] == "h2h":
            o = {x["name"]: x["price"] for x in mk["outcomes"]}
            if home in o and away in o and "Draw" in o:
                return {"h": o[home], "d": o["Draw"], "a": o[away]}
    return None


def _totals(book):
    for mk in book.get("markets", []):
        if mk["key"] == "totals":
            o = {x["name"]: x for x in mk["outcomes"]}
            if "Over" in o and "Under" in o and o["Over"].get("point") == o["Under"].get("point"):
                return {"line": o["Over"]["point"], "over": o["Over"]["price"], "under": o["Under"]["price"]}
    return None


def build_market(event):
    """从一场比赛的各家赔率算出盘口线。优先 Pinnacle，缺了就用各家中位数。"""
    home, away = event["home_team"], event["away_team"]
    books = {b["key"]: b for b in event.get("bookmakers", [])}

    h2h = tot = None
    source = None
    if MARKET_BOOK in books:
        h2h = _h2h(books[MARKET_BOOK], home, away)
        tot = _totals(books[MARKET_BOOK])
        source = "Pinnacle" if h2h else None
    if not h2h:
        allh = [x for x in (_h2h(b, home, away) for b in books.values()) if x]
        if not allh:
            return None, {}
        h2h = {k: statistics.median(x[k] for x in allh) for k in "hda"}
        source = f"{len(allh)} 家中位数"
    if not tot:
        allt = [x for x in (_totals(b) for b in books.values()) if x and x["line"] == 2.5]
        if allt:
            tot = {"line": 2.5,
                   "over": statistics.median(x["over"] for x in allt),
                   "under": statistics.median(x["under"] for x in allt)}

    ph, _, pa = model.devig([h2h["h"], h2h["d"], h2h["a"]])
    if tot:
        p_over = model.devig([tot["over"], tot["under"]])[0]
        lh, la = model.fit(ph, pa, tot["line"], p_over)
    else:
        lh, la = model.fit(ph, pa)

    market = {"source": source, "h2h": h2h, "total": tot}
    market.update(model.summarize(lh, la))

    compare = {}
    for key in COMPARE_BOOKS:
        if key in books:
            x = _h2h(books[key], home, away)
            if x:
                compare[key] = x
    return market, compare


def _plan(db, meta, league, t):
    """决定这个联赛这次要不要拉赔率。返回原因字符串或 None。"""
    state = meta.setdefault("leagues", {}).setdefault(league, {})
    last = parse_iso(state["odds_at"]) if state.get("odds_at") else None
    upcoming = [m for m in db["matches"].values()
                if m["league"] == league and parse_iso(m["kickoff"]) > t]
    soon = [m for m in upcoming if parse_iso(m["kickoff"]) <= t + timedelta(hours=WINDOW_H)]
    missing = [m for m in soon if not m.get("market")]
    remaining = meta.get("credits_remaining")

    if remaining is not None and remaining < 8:
        return None
    if missing:
        return f"{len(missing)} 场缺盘口"
    if remaining is not None and remaining < RESERVE:
        return None
    if soon and (last is None or t - last >= timedelta(hours=REFRESH_H)):
        return f"{len(soon)} 场即将开赛，刷新"
    if not upcoming and (last is None or t - last >= timedelta(hours=DISCOVER_H)):
        return "探查新赛程"
    return None


def run(db, meta, force=False):
    key = (os.environ.get("ODDS_API_KEY") or "").strip()
    if not key:
        log(meta, "赔率：缺少 ODDS_API_KEY，跳过")
        return
    t = now()
    for league, cfg in LEAGUES.items():
        reason = "手动强制" if force else _plan(db, meta, league, t)
        if not reason:
            continue
        status, data, headers = http_json(
            f"{ODDS_API}/sports/{cfg['sport']}/odds/",
            {"apiKey": key, "regions": "uk,eu", "markets": "h2h,totals", "oddsFormat": "decimal"})
        rem = headers.get("x-requests-remaining") or headers.get("X-Requests-Remaining")
        if rem is not None:
            try:
                meta["credits_remaining"] = int(float(rem))
            except ValueError:
                pass
        if status != 200 or not isinstance(data, list):
            log(meta, f"赔率：{cfg['name']} 失败 {status} {str(data)[:200]}")
            continue
        n_new = n_upd = 0
        for ev in data:
            kickoff = ev["commence_time"]
            if parse_iso(kickoff) <= t:
                continue  # 已开赛：返回的是滚球赔率，不覆盖赛前盘口
            m = db["matches"].get(ev["id"])
            if m is None:
                m = {"id": ev["id"], "league": league}
                db["matches"][ev["id"]] = m
                n_new += 1
            m.update({"home": ev["home_team"], "away": ev["away_team"], "kickoff": kickoff})
            market, compare = build_market(ev)
            if market:
                m["market"] = market
                m["books"] = compare
                m["odds_at"] = iso(t)
                n_upd += 1
        meta["leagues"][league]["odds_at"] = iso(t)
        log(meta, f"赔率：{cfg['name']}（{reason}）新增 {n_new} 场，更新 {n_upd} 场，剩余额度 {meta.get('credits_remaining')}")
