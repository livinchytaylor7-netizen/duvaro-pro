"""离线测试：用 2026-10-18 真实拉到的意甲赔率样本 + 模拟的 Gemini/比分回复，跑通全流程。"""
import json, sys, tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import common, odds, scores, ai, model, run, news  # noqa

SAMPLE = json.loads((ROOT / "tests/sample_odds_seriea.json").read_text())
T0 = datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc)
clock = {"t": T0}
calls = []

def fake_now():
    return clock["t"]

GEMINI_TEXT = '```json\n{"adjustments":[{"team":"home","category":"injury","delta":-0.6,"reason":"主力中锋伤缺","source":"example.com"},{"team":"away","category":"schedule","delta":0.1,"reason":"对手周中踢欧战","source":"x"},{"team":"bad","delta":1}],"confidence":"medium","summary":"主队锋线缺人"}\n```'

def fake_http(url, params=None, body=None, headers=None, timeout=60):
    calls.append(url)
    if "/odds/" in url:
        if "serie_a" in url:
            return 200, SAMPLE, {"x-requests-remaining": "480"}
        return 200, [], {"x-requests-remaining": "476"}
    if "/scores/" in url:
        out = []
        for ev in SAMPLE:
            out.append({"id": ev["id"], "completed": True,
                        "scores": [{"name": ev["home_team"], "score": "2"}, {"name": ev["away_team"], "score": "1"}]})
        return 200, out, {"x-requests-remaining": "470"}
    if "generativelanguage" in url:
        assert headers["x-goog-api-key"] == "g"
        assert "tools" not in body and "Leao out" in body["contents"][0]["parts"][0]["text"]
        return 200, {"candidates": [{"content": {"parts": [{"text": GEMINI_TEXT}]},
                     "groundingMetadata": {"webSearchQueries": ["q"], "groundingChunks": [{"web": {"uri": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AQ.Ab8RN6Kfm123456789012345", "title": "goal.com"}}]}}]}, {}
    raise AssertionError(url)

common.now = fake_now
ai.news.team_news = lambda team: ([{"title": "Leao out for three weeks", "source": "Goal", "url": "https://www.goal.com", "date": "2026-10-17"}], None)
for mod in (odds, scores, ai):
    mod.http_json = fake_http
    mod.now = fake_now
run.now = fake_now
ai.time.sleep = lambda s: None
ai.PAUSE_S = 0

def main():
    import os
    os.environ["ODDS_API_KEY"] = "o"; os.environ["GEMINI_API_KEY"] = "g"
    tmp = Path(tempfile.mkdtemp())
    for mod in (common, run):
        mod.MATCHES = tmp / "matches.json"; mod.META = tmp / "meta.json"

    # 1) 首次运行：两个联赛都要探查
    run.main(["run.py", "all"])
    db = json.loads((tmp / "matches.json").read_text()); meta = json.loads((tmp / "meta.json").read_text())
    ms = db["matches"]
    live = [e for e in SAMPLE if e["commence_time"] <= "2026-10-18T12:00:00Z"]
    assert len(ms) == len(SAMPLE) - len(live), (len(ms), len(SAMPLE), len(live))
    assert meta["credits_remaining"] == 480
    odds_calls = [c for c in calls if "/odds/" in c]; assert len(odds_calls) == 2, odds_calls
    juve = next(m for m in ms.values() if m["home"] == "Juventus")
    print("Juventus v Lazio market:", juve["market"]["source"], juve["market"]["lam_h"], juve["market"]["lam_a"], juve["market"]["top"], juve["market"]["top_p"])
    assert juve["market"]["source"] == "Pinnacle" and "paddypower" in juve["books"]
    # 与此前手算结果一致：约 1.90 / 0.86
    assert abs(juve["market"]["lam_h"] - 1.90) < 0.08 and abs(juve["market"]["lam_a"] - 0.86) < 0.08
    # AI：只分析 30 小时内的
    analysed = [m for m in ms.values() if (m.get("ai") or {}).get("status") == "ok"]
    in_window = [m for m in ms.values() if m["kickoff"] <= "2026-10-19T18:00:00Z"]
    assert len(analysed) == len(in_window), (len(analysed), len(in_window))
    a = juve["ai"]
    print("Juventus AI:", a["lam_h"], a["lam_a"], a["top"], [x["delta"] for x in a["adjustments"]])
    assert a["adjustments"][0]["delta"] == -0.25          # 单项上限
    assert abs(a["lam_h"] - (juve["market"]["lam_h"] - 0.25)) < 1e-3
    assert len(a["adjustments"]) == 2 and a["sources"][0]["source"] == "Goal" and a["searched"]

    # 2) 一小时后再跑：不应再拉赔率、不应重复 AI
    n_before = len(calls); clock["t"] = T0 + timedelta(hours=1)
    run.main(["run.py", "all"])
    assert not [c for c in calls[n_before:] if "/odds/" in c or "/scores/" in c], calls[n_before:]  # 窗口滑动可新增 AI 分析

    # 3) 次日早上：刷新赔率，并结算前一天比赛
    clock["t"] = T0 + timedelta(hours=20)
    run.main(["run.py", "all"])
    db = json.loads((tmp / "matches.json").read_text())
    settled = [m for m in db["matches"].values() if m.get("result")]
    print("settled:", len(settled), [ (m["home"], m["result"]) for m in settled][:3])
    assert settled and all(m["result"]["h"] == 2 for m in settled)
    print("calls:", [c.split("/sports/")[1] if "/sports/" in c else "gemini" for c in calls])
    print("ALL TESTS PASSED")

main()
