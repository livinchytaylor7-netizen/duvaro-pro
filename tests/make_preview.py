"""生成本地预览数据（不提交）：真实赔率样本，前 4 场当作已结束，并附几条“我的线”。"""
import json, shutil, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import odds  # noqa: E402
out = Path(sys.argv[1]); (out / "data").mkdir(parents=True, exist_ok=True)
now = datetime.now(timezone.utc)
ev = [e for e in json.loads((ROOT / "tests/sample_odds_seriea.json").read_text()) if e["commence_time"] > "2026-10-18T12:00:00Z"]
ms, picks = {}, {}
for i, e in enumerate(ev):
    mk, books = odds.build_market(e)
    k = (now - timedelta(days=1, hours=i)) if i < 4 else (now + timedelta(hours=3 + i))
    m = {"id": e["id"], "league": "seriea", "home": e["home_team"], "away": e["away_team"],
         "kickoff": k.strftime("%Y-%m-%dT%H:%M:%SZ"), "market": mk, "books": books, "odds_at": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
    if i < 4:
        m["result"] = {"h": [2, 1, 0, 3][i], "a": [1, 1, 2, 1][i]}
        lk = (k - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        sides = ["under", "over", "over", "none"]
        picks[e["id"]] = {"h": 2, "a": 1, "hedge": sides[i], "hedge_odds": mk["wh25"].get(sides[i]) if sides[i] != "none" else None, "locked_at": lk}
    ms[e["id"]] = m
(out / "data/matches.json").write_text(json.dumps({"matches": ms, "updated": now.isoformat()}))
(out / "data/picks.json").write_text(json.dumps(picks))
(out / "data/meta.json").write_text(json.dumps({"credits_remaining": 440, "log": ["x"]}))
for f in ["index.html", "app.js", "style.css", "teams.js", "icon.svg", "manifest.webmanifest", "icon-180.png"]:
    shutil.copy(ROOT / f, out / f)
print("preview", len(ms))
