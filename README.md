# Duvaro Pro

比分预测实验系统：同一批比赛上，比较**盘口线**（Pinnacle 推算的最热门比分）、**AI 线**（Gemini 查场外信息后修正）和**我的线**（Lee 自己的判断），看哪种方法更有效。

只做模拟和记录，不连接任何博彩账户，不自动下注。

## 运行方式

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| 每日任务 | `.github/workflows/daily.yml` | UTC 06:15 / 11:15 / 16:15 / 22:45 自动运行 |
| 赔率 | `scripts/odds.py` | The Odds API，只在 36 小时内有比赛时拉取 |
| AI 分析 | `scripts/ai.py` | Gemini 2.5 Flash + Google 搜索，开赛前 30 小时内逐场分析 |
| 赛果 | `scripts/scores.py` | 赛后自动拉比分 |
| 比分模型 | `scripts/model.py` | Dixon-Coles 修正泊松模型 |
| 手机 app | `index.html` `app.js` | GitHub Pages 托管 |
| 数据 | `data/` | `matches.json` 比赛与预测，`picks.json` 我的线，`meta.json` 运行状态 |

## 需要的加密设置（Settings → Secrets and variables → Actions）

- `ODDS_API_KEY`：The Odds API 密钥
- `GEMINI_API_KEY`：Google AI Studio 密钥

## 手动运行

Actions → Duvaro 每日任务 → Run workflow。可选只跑某一步，或强制拉一次赔率。

## 本地测试

```
pip install numpy scipy
python tests/test_pipeline.py
```

方案文档：Duvaro Pro 框架与方案 V1.0
