"""生成本地预览数据（不提交）：真实赔率样本 + 模拟 AI + 几场假赛果和假预测。"""
import json, sys, shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
out = Path(sys.argv[1])
import test_pipeline as tp  # 复用模拟接口
import common, run
tp.clock["t"] = datetime(2026, 10, 18, 8, 0, tzinfo=timezone.utc)
import os; os.environ["ODDS_API_KEY"] = "o"; os.environ["GEMINI_API_KEY"] = "g"
for mod in (common, run):
    mod.MATCHES = out / "data/matches.json"; mod.META = out / "data/meta.json"
run.main(["run.py", "all"])
db = json.loads((out / "data/matches.json").read_text())
ms = sorted(db["matches"].values(), key=lambda m: m["kickoff"])
picks = {}
# 前 4 场挪到昨天并给出赛果
res = [(2, 0), (1, 1), (1, 2), (2, 1)]
for m, r in zip(ms[:4], res):
    k = datetime.fromisoformat(m["kickoff"].replace("Z", "+00:00")) - timedelta(days=1)
    m["kickoff"] = k.strftime("%Y-%m-%dT%H:%M:%SZ"); m["result"] = {"h": r[0], "a": r[1], "at": "x"}
    picks[m["id"]] = {"h": r[0] if m is ms[0] else 1, "a": r[1] if m is ms[0] else 0, "locked_at": (k - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")}
ms[3]["ai"] = {"status": "failed", "tries": 1, "error": "Gemini 429: quota", "at": "2026-10-18T08:00:00Z"}
# 第 6 场：已锁定（今天之后）
picks[ms[5]["id"]] = {"h": 2, "a": 1, "locked_at": "2026-10-18T09:00:00Z"}
picks[ms[6]["id"]] = {"skip": True, "locked_at": "2026-10-18T09:00:00Z"}
(out / "data/matches.json").write_text(json.dumps(db, ensure_ascii=False))
(out / "data/picks.json").write_text(json.dumps(picks))
for f in ["index.html", "app.js", "style.css", "teams.js", "icon.svg", "manifest.webmanifest", "icon-180.png"]:
    shutil.copy(ROOT / f, out / f)
print("preview ready", len(ms))
