"""每日任务入口：python scripts/run.py [all|odds|ai|scores] [--force-odds]"""
import sys

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

    if step in ("all", "scores"):
        scores.run(db, meta)
    if step in ("all", "odds"):
        odds.run(db, meta, force=force)
        ai.reapply(db)
    if step in ("all", "ai"):
        ai.run(db, meta)

    db["updated"] = iso(now())
    meta["last_run"] = {"at": iso(t), "step": step}
    save(MATCHES, db)
    save(META, meta)
    log(meta, f"完成：共 {len(db['matches'])} 场比赛记录")
    save(META, meta)


if __name__ == "__main__":
    main(sys.argv)
