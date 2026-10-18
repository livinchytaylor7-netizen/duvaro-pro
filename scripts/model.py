"""比分模型：从胜平负 + 大小球赔率反推两队预期进球，再算出全部比分概率。

使用 Dixon-Coles 修正的泊松模型。RHO 与前端 app.js 中的值必须保持一致。
"""
import math

import numpy as np
from scipy.optimize import minimize

RHO = -0.08
N = 11  # 每队 0..10 球


def _pmf(lam):
    out = np.empty(N)
    out[0] = math.exp(-lam)
    for k in range(1, N):
        out[k] = out[k - 1] * lam / k
    return out


def score_matrix(lh, la, rho=RHO):
    m = np.outer(_pmf(lh), _pmf(la))
    m[0, 0] *= 1 - lh * la * rho
    m[0, 1] *= 1 + lh * rho
    m[1, 0] *= 1 + la * rho
    m[1, 1] *= 1 - rho
    m = np.clip(m, 0, None)
    return m / m.sum()


def outcome_probs(m):
    return float(np.tril(m, -1).sum()), float(np.trace(m)), float(np.triu(m, 1).sum())


def _total_dist(m):
    tot = np.zeros(2 * N - 1)
    for i in range(N):
        for j in range(N):
            tot[i + j] += m[i, j]
    return tot


def _components(line):
    """亚盘线拆分：2.75 → [2.5, 3.0]；2.5 → [2.5]；3.0 → [3.0]。"""
    q = round(line * 4)
    if q % 2 == 1:
        return [(q - 1) / 4, (q + 1) / 4]
    return [q / 4]


def total_over_prob(m, line):
    """模型下“大球”的去水概率（与市场去水概率同口径，含走盘/半赢半输）。"""
    tot = _total_dist(m)
    ks = np.arange(len(tot))
    comps = _components(line)
    win_o = lose_o = 0.0
    for c in comps:
        win_o += tot[ks > c].sum() / len(comps)
        lose_o += tot[ks < c].sum() / len(comps)
    # 大球公平赔率 o 满足 win*(o-1) = lose；小球对称
    if win_o <= 0 or lose_o <= 0:
        return 1.0 if lose_o <= 0 else 0.0
    o_over = 1 + lose_o / win_o
    o_under = 1 + win_o / lose_o
    a, b = 1 / o_over, 1 / o_under
    return a / (a + b)


def devig(prices):
    inv = [1 / p for p in prices]
    s = sum(inv)
    return [x / s for x in inv]


def fit(p_home, p_away, line=None, p_over=None):
    """拟合两队预期进球。没有大小球时，用总进球 2.6 作为弱先验。"""

    def loss(x):
        m = score_matrix(*x)
        ph, _, pa = outcome_probs(m)
        e = (ph - p_home) ** 2 + (pa - p_away) ** 2
        if line is not None and p_over is not None:
            e += (total_over_prob(m, line) - p_over) ** 2
        else:
            e += 0.002 * (x[0] + x[1] - 2.6) ** 2
        return e

    best = None
    for start in ([1.4, 1.1], [2.0, 0.8], [0.9, 1.6]):
        r = minimize(loss, start, bounds=[(0.1, 5.0), (0.1, 5.0)], method="L-BFGS-B")
        if best is None or r.fun < best.fun:
            best = r
    return float(best.x[0]), float(best.x[1])


def top_score(m, max_goals=6):
    best = (0.0, 0, 0)
    for i in range(max_goals + 1):
        for j in range(max_goals + 1):
            if m[i, j] > best[0]:
                best = (float(m[i, j]), i, j)
    return [best[1], best[2]], best[0]


def summarize(lh, la):
    m = score_matrix(lh, la)
    ph, pd, pa = outcome_probs(m)
    top, top_p = top_score(m)
    return {
        "lam_h": round(lh, 3),
        "lam_a": round(la, 3),
        "probs": {"h": round(ph, 4), "d": round(pd, 4), "a": round(pa, 4)},
        "top": top,
        "top_p": round(top_p, 4),
    }


def score_prob(lh, la, h, a):
    if h >= N or a >= N:
        return 0.0
    return float(score_matrix(lh, la)[h, a])
