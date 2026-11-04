"""离线测试：用 2026-10-18 真实拉到的意甲赔率样本 + 模拟的比分回复，跑通全流程。"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import common, odds, run, scores  # noqa: E402

SAMPLE = json.loads((ROOT / "tests/sample_odds_seriea.json").read_text())
T0 = datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc)
clock = {"t": T0}
calls = []


def fake_now():
    return clock["t"]


def fake_http(url, params=None, body=None, headers=None, timeout=60):
    calls.append(url)
    if "/odds/" in url:
        if "serie_a" in url:
            return 200, SAMPLE, {"x-requests-remaining": "480"}
        return 200, [], {"x-requests-remaining": "476"}
    if "/scores/" in url:
        out = [{"id": ev["id"], "completed": True,
                "scores": [{"name": ev["home_team"], "score": "2"}, {"name": ev["away_team"], "score": "1"}]}
               for ev in SAMPLE]
        return 200, out, {"x-requests-remaining": "470"}
    raise AssertionError(url)


common.now = fake_now
for mod in (odds, scores, run):
    mod.now = fake_now
odds.http_json = fake_http
scores.http_json = fake_http


def main():
    os.environ["ODDS_API_KEY"] = "o"
    tmp = Path(tempfile.mkdtemp())
    for mod in (common, run):
        mod.MATCHES = tmp / "matches.json"
        mod.META = tmp / "meta.json"

    # 1) 首次运行：四个联赛都要探查
    run.main(["run.py", "all"])
    db = json.loads((tmp / "matches.json").read_text())
    meta = json.loads((tmp / "meta.json").read_text())
    ms = db["matches"]
    live = [e for e in SAMPLE if e["commence_time"] <= "2026-10-18T12:00:00Z"]
    assert len(ms) == len(SAMPLE) - len(live), (len(ms), len(SAMPLE), len(live))
    assert len([c for c in calls if "/odds/" in c]) == 4
    assert meta["credits_remaining"] == 476
    assert not meta.get("errors"), meta.get("errors")
    juve = next(m for m in ms.values() if m["home"] == "Juventus")
    mk = juve["market"]
    print("Juventus v Lazio:", mk["source"], mk["lam_h"], mk["lam_a"], mk["top"], mk.get("wh25"))
    assert mk["source"] == "Pinnacle" and "paddypower" in juve["books"]
    assert abs(mk["lam_h"] - 1.90) < 0.08 and abs(mk["lam_a"] - 0.86) < 0.08
    # William Hill 2.5 盘：样本 15 场赛前比赛场场都有
    with_wh = [m for m in ms.values() if (m.get("market") or {}).get("wh25")]
    assert len(with_wh) == len(ms), (len(with_wh), len(ms))
    assert all(1 < m["market"]["wh25"]["over"] < 10 for m in with_wh)
    assert "ai" not in juve

    # 2) 一小时后再跑：不应再拉赔率或赛果
    n = len(calls)
    clock["t"] = T0 + timedelta(hours=1)
    run.main(["run.py", "all"])
    assert len(calls) == n, calls[n:]

    # 3) 次日早上：结算前一天比赛
    clock["t"] = T0 + timedelta(hours=20)
    run.main(["run.py", "all"])
    db = json.loads((tmp / "matches.json").read_text())
    settled = [m for m in db["matches"].values() if m.get("result")]
    assert settled and all(m["result"]["h"] == 2 for m in settled)

    # 4) 强制拉赔率：没有历史记录的新联赛也不能报错
    meta = json.loads((tmp / "meta.json").read_text())
    meta["leagues"].pop("champ", None)
    (tmp / "meta.json").write_text(json.dumps(meta))
    run.main(["run.py", "odds", "--force-odds"])
    assert not json.loads((tmp / "meta.json").read_text()).get("errors"), "强制模式出错"
    print("ALL TESTS PASSED")


main()
