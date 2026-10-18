"""拉取赛果并写入比赛记录。只有存在“已踢完但未结算”的比赛时才调用（每次 2 次额度）。"""
import os
from datetime import timedelta

from common import LEAGUES, ODDS_API, http_json, iso, log, now, parse_iso

FINISH_AFTER_H = 2.5   # 开赛 2.5 小时后视为已结束
GIVE_UP_DAYS = 3       # 接口只保留 3 天比分，超过就标记为无法结算


def run(db, meta):
    key = os.environ.get("ODDS_API_KEY")
    if not key:
        log(meta, "赛果：缺少 ODDS_API_KEY，跳过")
        return
    t = now()
    for league, cfg in LEAGUES.items():
        pending = [m for m in db["matches"].values()
                   if m["league"] == league and not m.get("result")
                   and parse_iso(m["kickoff"]) + timedelta(hours=FINISH_AFTER_H) <= t]
        if not pending:
            continue
        stale = [m for m in pending if t - parse_iso(m["kickoff"]) > timedelta(days=GIVE_UP_DAYS)]
        for m in stale:
            m["result"] = {"void": True, "note": "超过 3 天未取到比分"}
        pending = [m for m in pending if m not in stale]
        if not pending:
            continue
        rem = meta.get("credits_remaining")
        if rem is not None and rem < 4:
            log(meta, "赛果：额度不足，跳过")
            return
        status, data, headers = http_json(
            f"{ODDS_API}/sports/{cfg['sport']}/scores/", {"apiKey": key, "daysFrom": 3})
        r = headers.get("x-requests-remaining") or headers.get("X-Requests-Remaining")
        if r is not None:
            try:
                meta["credits_remaining"] = int(float(r))
            except ValueError:
                pass
        if status != 200 or not isinstance(data, list):
            log(meta, f"赛果：{cfg['name']} 失败 {status} {str(data)[:200]}")
            continue
        by_id = {ev["id"]: ev for ev in data}
        done = 0
        for m in pending:
            ev = by_id.get(m["id"])
            if not ev or not ev.get("completed") or not ev.get("scores"):
                continue
            sc = {s["name"]: s["score"] for s in ev["scores"]}
            try:
                h, a = int(sc[m["home"]]), int(sc[m["away"]])
            except (KeyError, ValueError, TypeError):
                continue
            m["result"] = {"h": h, "a": a, "at": iso(t)}
            done += 1
        log(meta, f"赛果：{cfg['name']} 结算 {done}/{len(pending)} 场，剩余额度 {meta.get('credits_remaining')}")
