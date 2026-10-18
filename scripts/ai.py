"""AI 线：Gemini 上网查场外信息，在盘口基础上修正两队预期进球。

规则（见方案文档）：
- 只调整预期进球，比分由模型重新计算
- 单项调整不超过 ±0.25 球，每队总调整不超过 ±0.4 球
- 没有可靠信息就不调，AI 线 = 盘口线
- 调用失败时标记 failed，前端把 AI 线显示为“未分析”，统计时按盘口线处理
"""
import json
import os
import re
import time
from datetime import timedelta

import model
from common import GEMINI_MODEL, GEMINI_URL, LEAGUES, http_json, iso, log, now, parse_iso

WINDOW_H = 30
MAX_PER_RUN = 20
PAUSE_S = 7
MAX_TRIES = 3
ITEM_CAP = 0.25
TEAM_CAP = 0.4
CATEGORIES = {"injury": "伤停", "suspension": "停赛", "lineup": "首发/轮换", "form": "状态/xG",
              "schedule": "赛程/体能", "motivation": "比赛动机", "coach": "主帅/战术", "other": "其他"}

PROMPT = """You are a football analyst. Use Google Search to research this upcoming match and decide whether
the betting market below has missed any concrete, recent, team-specific information.

Match: {home} (home) vs {away} (away)
Competition: {league}
Kickoff (UTC): {kickoff}
Today (UTC): {today}

Market baseline (Pinnacle, de-margined):
- Win probabilities: home {ph:.0%}, draw {pd:.0%}, away {pa:.0%}
- Expected goals: {home} {lh:.2f}, {away} {la:.2f}
{total_line}

Research, for BOTH teams, using sources from the last 7 days where possible:
1. Injuries, suspensions, players returning, likely or confirmed line-ups and rotation
2. Recent form and underlying numbers (xG for/against) versus actual results
3. Fixture congestion (European or cup matches in the previous or next 4 days), travel
4. Motivation and context (relegation, title race, derby, new coach, dressing-room news)

Then propose adjustments to each team's expected goals. Rules:
- The market already prices widely known information. Adjust only for specific facts you found.
- Each adjustment between -0.25 and +0.25 goals. Most matches need 0 to 2 adjustments.
- A key striker missing lowers that team's goals; a key defender or goalkeeper missing raises the opponent's.
- If you find nothing concrete, return an empty adjustments list.

Reply with ONLY a JSON object, no other text:
{{"adjustments": [{{"team": "home" or "away", "category": one of {cats}, "delta": number,
   "reason": "Simplified Chinese, max 40 characters", "source": "site name or URL"}}],
 "confidence": "high" or "medium" or "low",
 "summary": "Simplified Chinese, max 60 characters: what the market may have missed, or that nothing was found"}}
"""


def _extract_json(text):
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("回复中没有 JSON")
    return json.loads(text[start:end + 1])


def _clean_source(src):
    src = str(src or "")[:200]
    if "vertexaisearch" in src or "grounding-api-redirect" in src:
        return ""
    return src


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def apply_adjustments(market, raw):
    """把 AI 建议的调整落到预期进球上，执行幅度上限。"""
    adjs = []
    total = {"home": 0.0, "away": 0.0}
    for a in raw.get("adjustments") or []:
        try:
            team = a["team"] if a.get("team") in ("home", "away") else None
            delta = float(a.get("delta", 0))
        except (TypeError, ValueError):
            continue
        if not team or delta == 0:
            continue
        delta = _clamp(delta, -ITEM_CAP, ITEM_CAP)
        room_hi, room_lo = TEAM_CAP - total[team], -TEAM_CAP - total[team]
        delta = _clamp(delta, room_lo, room_hi)
        if abs(delta) < 0.005:
            continue
        total[team] += delta
        cat = a.get("category") if a.get("category") in CATEGORIES else "other"
        adjs.append({"team": team, "category": cat, "delta": round(delta, 3),
                     "reason": str(a.get("reason", ""))[:80], "source": _clean_source(a.get("source", ""))})
    lh = max(0.15, market["lam_h"] + total["home"])
    la = max(0.15, market["lam_a"] + total["away"])
    out = model.summarize(lh, la)
    out["adjustments"] = adjs
    conf = raw.get("confidence")
    out["confidence"] = conf if conf in ("high", "medium", "low") else "low"
    out["summary"] = str(raw.get("summary", ""))[:120]
    return out


def reapply(db):
    """盘口刷新后，把已有的 AI 调整重新套到最新盘口上（不再调用 Gemini）。"""
    for m in db["matches"].values():
        ai = m.get("ai") or {}
        mk = m.get("market")
        if ai.get("status") != "ok" or not mk or m.get("result"):
            continue
        base = ai.get("base") or {}
        if base.get("lam_h") == mk["lam_h"] and base.get("lam_a") == mk["lam_a"]:
            continue
        keep = {k: ai[k] for k in ("status", "at", "tries", "sources", "searched") if k in ai}
        out = apply_adjustments(mk, ai)
        out.update(keep)
        out["base"] = {"lam_h": mk["lam_h"], "lam_a": mk["lam_a"]}
        m["ai"] = out


def analyze(match, key, t):
    mk = match["market"]
    tot = mk.get("total")
    total_line = (f"- Total goals line {tot['line']}: over {model.devig([tot['over'], tot['under']])[0]:.0%}"
                  if tot else "- No total goals line available")
    prompt = PROMPT.format(
        home=match["home"], away=match["away"], league=LEAGUES[match["league"]]["sport"],
        kickoff=match["kickoff"], today=iso(t), ph=mk["probs"]["h"], pd=mk["probs"]["d"],
        pa=mk["probs"]["a"], lh=mk["lam_h"], la=mk["lam_a"], total_line=total_line,
        cats="/".join(CATEGORIES))
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"temperature": 0.2}}
    status, data, _ = http_json(GEMINI_URL.format(model=GEMINI_MODEL), body=body,
                                headers={"x-goog-api-key": key}, timeout=120)
    if status != 200 or not isinstance(data, dict):
        raise RuntimeError(f"Gemini {status}: {str(data)[:300]}")
    cand = (data.get("candidates") or [{}])[0]
    text = "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))
    raw = _extract_json(text)
    out = apply_adjustments(mk, raw)
    sources = []
    for ch in (cand.get("groundingMetadata") or {}).get("groundingChunks") or []:
        web = ch.get("web") or {}
        title = (web.get("title") or "").strip()[:80]
        # Google 返回的是带令牌的跳转链接，不能存进公开仓库；只保留来源网站名
        if title and title not in [x["title"] for x in sources]:
            url = f"https://{title}" if re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", title.lower()) else None
            sources.append({"title": title, "url": url})
    out["sources"] = sources[:8]
    out["searched"] = bool((cand.get("groundingMetadata") or {}).get("webSearchQueries"))
    return out


def run(db, meta):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        log(meta, "AI：缺少 GEMINI_API_KEY，跳过")
        return
    t = now()
    todo = []
    for m in db["matches"].values():
        k = parse_iso(m["kickoff"])
        if not m.get("market") or k <= t or k > t + timedelta(hours=WINDOW_H):
            continue
        ai = m.get("ai") or {}
        if ai.get("status") == "ok":
            continue
        if ai.get("tries", 0) >= MAX_TRIES:
            continue
        todo.append(m)
    todo.sort(key=lambda m: m["kickoff"])
    done = failed = 0
    for i, m in enumerate(todo[:MAX_PER_RUN]):
        if i:
            time.sleep(PAUSE_S)
        tries = (m.get("ai") or {}).get("tries", 0) + 1
        try:
            out = analyze(m, key, t)
            out.update({"status": "ok", "at": iso(now()), "tries": tries,
                        "base": {"lam_h": m["market"]["lam_h"], "lam_a": m["market"]["lam_a"]}})
            m["ai"] = out
            done += 1
        except Exception as e:  # 记录失败，下次运行重试
            m["ai"] = {"status": "failed", "at": iso(now()), "tries": tries, "error": str(e)[:300]}
            failed += 1
            if "429" in str(e):
                log(meta, "AI：触发频率限制，本次停止")
                break
    if todo:
        log(meta, f"AI：分析 {done} 场，失败 {failed} 场，待分析 {len(todo)} 场")
