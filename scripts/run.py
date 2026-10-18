"""每日任务入口：python scripts/run.py [all|odds|ai|scores] [--force-odds]

每一步单独捕获错误：一步出错不影响其他步骤，错误详情写进 data/meta.json 的 errors，
数据照常保存。只有所有步骤都出错时才以失败状态退出。
"""
import sys
import traceback

import ai
import odds
import scores
from common import MATCHES, META, iso, load, log, now, save


def main(argv):
    step = argv[1] if len(argv) > 1 and not argv[1].startswith("--") else "all"
    force = "--force-odds" in argv
    db = load(MATCHES, {"matches": {}})
    meta = load(META, {})
    t = now()

    plan = []
    if step in ("all", "scores"):
        plan.append(("赛果", lambda: scores.run(db, meta)))
    if step in ("all", "odds"):
        plan.append(("赔率", lambda: (odds.run(db, meta, force=force), ai.reapply(db))))
    if step in ("all", "ai"):
        plan.append(("AI", lambda: ai.run(db, meta)))

    errors = []
    for name, fn in plan:
        try:
            fn()
        except Exception:
            tb = traceback.format_exc()
            print(tb, file=sys.stderr)
            errors.append({"step": name, "at": iso(now()), "trace": tb[-3000:]})
            log(meta, f"{name}：程序出错，详情见 errors")
    meta["errors"] = (meta.get("errors", []) + errors)[-20:]

    db["updated"] = iso(now())
    meta["last_run"] = {"at": iso(t), "step": step, "ok": not errors}
    log(meta, f"完成：共 {len(db['matches'])} 场比赛记录")
    save(MATCHES, db)
    save(META, meta)
    return 1 if plan and len(errors) == len(plan) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
