"use strict";
// Duvaro Pro 前端。数据来自仓库 data/ 目录；Lee 的预测写回 data/picks.json。

const RHO = -0.08;          // 必须与 scripts/model.py 一致
const STAKE = 10;           // 每场模拟 €10
const MARGIN = 0.25;        // 博彩公司正确比分约 25% 抽水
const N = 11;
const TZ = "Europe/Dublin";
const LEAGUE = { laliga: "西甲", seriea: "意甲", ligue1: "法甲", champ: "英冠" };
const BOOK = { pinnacle: "Pinnacle", paddypower: "Paddy Power", boylesports: "BoyleSports",
  betfair_ex_uk: "Betfair 交易所", williamhill: "William Hill", skybet: "Sky Bet",
  ladbrokes_uk: "Ladbrokes", betvictor: "BetVictor", unibet_uk: "Unibet", smarkets: "Smarkets" };

const S = { matches: {}, picks: {}, meta: {}, updated: null, tab: "today", draft: {}, hedgeDraft: {},
  token: lsGet("duvaro_token"), repo: lsGet("duvaro_repo") || detectRepo() };

// ---------- 工具 ----------
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? esc(u) : null; }
function pct(x, d = 0) { return (x * 100).toFixed(d) + "%"; }
function sc(t) { return t ? `${t[0]}-${t[1]}` : "—"; }
function $(sel) { return document.querySelector(sel); }
function detectRepo() {
  const h = location.hostname, seg = location.pathname.split("/").filter(Boolean)[0];
  if (h.endsWith(".github.io") && seg) return `${h.replace(".github.io", "")}/${seg}`;
  return "livinchytaylor7-netizen/duvaro-pro";
}
function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
const fDay = new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, month: "numeric", day: "numeric", weekday: "short" });
const fTime = new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const fFull = new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const kt = m => Date.parse(m.kickoff);

// ---------- 比分模型（与 Python 相同） ----------
function pmf(l) { const o = [Math.exp(-l)]; for (let k = 1; k < N; k++) o.push(o[k - 1] * l / k); return o; }
const _mcache = new Map();
function matrix(lh, la) {
  const key = lh + "|" + la; if (_mcache.has(key)) return _mcache.get(key);
  const ph = pmf(lh), pa = pmf(la); let m = [], s = 0;
  for (let i = 0; i < N; i++) { m.push([]); for (let j = 0; j < N; j++) m[i].push(ph[i] * pa[j]); }
  m[0][0] *= 1 - lh * la * RHO; m[0][1] *= 1 + lh * RHO; m[1][0] *= 1 + la * RHO; m[1][1] *= 1 - RHO;
  for (const r of m) for (let j = 0; j < N; j++) { r[j] = Math.max(0, r[j]); s += r[j]; }
  for (const r of m) for (let j = 0; j < N; j++) r[j] /= s;
  _mcache.set(key, m); return m;
}
// ---------- 总进球对冲（William Hill 大/小 2.5 球） ----------
// 比分 €10 + 一注大/小 2.5 球，金额 = 10 ÷ (赔率 − 1)：对冲赢、比分没中 = 刚好持平；都输 = 全输（接受）
const HEDGE_BOOK = "William Hill";
const SIDE = { over: "大 2.5 球", under: "小 2.5 球" };
const inSide = (side, tot) => side === "under" ? tot <= 2 : tot >= 3;
function defaultSide(t) { return t[0] + t[1] >= 3 ? "under" : "over"; } // 与比分互斥的一边
function pTotalSide(mk, side) {
  const g = matrix(mk.lam_h, mk.lam_a); let p = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (inSide(side, i + j)) p += g[i][j];
  return p;
}
function whOdds(m, side) { const w = m.market && m.market.wh25; return w && w[side] > 1 ? w[side] : null; }
function hedgeOf(m, t, side, oddsOverride) {
  const mk = m.market; if (!mk || !t || !side || side === "none") return null;
  const oH = oddsOverride || whOdds(m, side); if (!oH) return null;
  const hStake = STAKE / (oH - 1), pS = pScore(mk, t), pSide = pTotalSide(mk, side);
  const overlap = inSide(side, t[0] + t[1]); // 同向：比分中时对冲也中
  const pEven = Math.max(0, pSide - (overlap ? pS : 0));
  const oSf = 1 / pS, oSb = Math.max(1.01, oSf * (1 - MARGIN));
  const hitBonus = overlap ? hStake * oH : 0;
  return { side, label: SIDE[side], oH, hStake, pS, pEven, pLose: Math.max(0, 1 - pS - pEven), oSf, oSb, overlap,
    winF: STAKE * oSf + hitBonus - STAKE - hStake, winB: STAKE * oSb + hitBonus - STAKE - hStake, lose: -(STAKE + hStake) };
}
function hedgeFor(m, key) { // key: market | mine
  const L = lines(m), t = L[key]; if (!t) return null;
  if (key === "mine") { const p = S.picks[m.id] || {}; return hedgeOf(m, t, p.hedge || null, p.hedge_odds); }
  return hedgeOf(m, t, defaultSide(t));
}
function hedgeOutcome(m, key) {
  const r = result(m), h = hedgeFor(m, key); if (!r || !h) return null;
  const t = lines(m)[key];
  const kind = same(t, r) ? "hit" : inSide(h.side, r[0] + r[1]) ? "even" : "lose";
  return { h, kind, netF: kind === "hit" ? h.winF : kind === "even" ? 0 : h.lose, netB: kind === "hit" ? h.winB : kind === "even" ? 0 : h.lose };
}
function hedgeAgg(list, key) {
  const a = { n: 0, hit: 0, even: 0, lose: 0, eHit: 0, eEven: 0, eLose: 0, cost: 0, netF: 0, netB: 0 };
  for (const m of list) {
    const o = hedgeOutcome(m, key); if (!o) continue;
    a.n++; a[o.kind]++; a.eHit += o.h.pS; a.eEven += o.h.pEven; a.eLose += o.h.pLose;
    a.cost += STAKE + o.h.hStake; a.netF += o.netF; a.netB += o.netB;
  }
  return a;
}
const eu = x => `${x >= 0 ? "+" : "−"}€${Math.abs(x).toFixed(2)}`;
function hedgeLine(h) { return h ? `对冲：${h.label} €${h.hStake.toFixed(2)}（${HEDGE_BOOK} ${h.oH.toFixed(2)}）` : ""; }
function hedgeHtml(m, key, who) {
  const t = lines(m)[key]; if (!t) return "";
  const p = S.picks[m.id] || {};
  if (key === "mine" && (!p.hedge || p.hedge === "none")) return `<h3>总进球对冲（${who} ${sc(t)}）</h3><p class="hint">这场没有对冲。</p>`;
  const h = hedgeFor(m, key);
  if (!h) return `<h3>总进球对冲（${who} ${sc(t)}）</h3><p class="hint">${HEDGE_BOOK} 这场没有开大小 2.5 球盘，不对冲。</p>`;
  return `<h3>总进球对冲（${who} ${sc(t)}）</h3>
    <table><tr><th>投注</th><th>金额</th><th>赔率</th></tr>
    <tr><td>比分 ${sc(t)}</td><td>€${STAKE.toFixed(2)}</td><td>${h.oSf.toFixed(1)} 公平 / ${h.oSb.toFixed(1)} 扣水</td></tr>
    <tr><td>${h.label}</td><td>€${h.hStake.toFixed(2)}</td><td>${h.oH.toFixed(2)}（${HEDGE_BOOK}）</td></tr></table>
    <table style="margin-top:8px"><tr><th>结果</th><th>概率</th><th>盈亏</th></tr>
    <tr><td>比分命中${h.overlap ? "（对冲也中）" : ""}</td><td>${pct(h.pS, 1)}</td><td class="pos">${eu(h.winF)} / ${eu(h.winB)}</td></tr>
    <tr><td>对冲命中（持平）</td><td>${pct(h.pEven, 1)}</td><td>€0.00</td></tr>
    <tr><td>全部失败</td><td>${pct(h.pLose, 1)}</td><td class="neg">${eu(h.lose)}</td></tr></table>
    <div class="legend">总投入 €${(STAKE + h.hStake).toFixed(2)}。概率按 Pinnacle 推算${h.overlap ? "；你选的对冲和比分同方向，比分中时两注都赢" : "；比分和对冲互斥，不会同时赢"}。${key === "mine" ? "赔率为锁定时的价格。" : ""}</div>`;
}

function pScore(mk, t) { return t && t[0] < N && t[1] < N ? matrix(mk.lam_h, mk.lam_a)[t[0]][t[1]] : 0; }

// ---------- 三条线 ----------
function pickOf(m) {
  const p = S.picks[m.id]; if (!p || p.skip || p.h == null) return null;
  if (p.locked_at && Date.parse(p.locked_at) > kt(m)) return null; // 开赛后锁定的不算
  return [p.h, p.a];
}
function lines(m) {
  return { market: m.market ? m.market.top : null, mine: pickOf(m) };
}
function revealed(m) { return !!S.picks[m.id] || Date.now() >= kt(m); }
function result(m) { return m.result && m.result.h != null ? [m.result.h, m.result.a] : null; }
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

// ---------- 数据读写 ----------
async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${S.repo}${path}`, {
    ...opts, headers: { Authorization: `Bearer ${S.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) } });
  return r;
}
async function readJson(path, fallback) {
  try {
    if (S.token) {
      const r = await gh(`/contents/${path}`, { headers: { Accept: "application/vnd.github.raw+json" }, cache: "no-store" });
      if (r.status === 404) return fallback;
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    }
    const r = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    return r.ok ? await r.json() : fallback;
  } catch (e) { console.warn(path, e); return fallback; }
}
async function loadAll() {
  const [db, picks, meta] = await Promise.all([
    readJson("data/matches.json", { matches: {} }), readJson("data/picks.json", {}), readJson("data/meta.json", {})]);
  S.matches = db.matches || {}; S.updated = db.updated; S.picks = picks || {}; S.meta = meta || {};
  render();
}
const b64e = s => btoa(unescape(encodeURIComponent(s)));
const b64d = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));
async function savePick(id, value) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await gh(`/contents/data/picks.json`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    let sha, cur = {};
    if (r.ok) { const j = await r.json(); sha = j.sha; cur = JSON.parse(b64d(j.content) || "{}"); }
    else if (r.status !== 404) throw new Error(`读取失败 ${r.status}`);
    if (cur[id]) { S.picks = cur; throw new Error("这场已经锁定过了"); }
    cur[id] = value;
    const body = { message: `pick ${id}`, content: b64e(JSON.stringify(cur, null, 1) + "\n") };
    if (sha) body.sha = sha;
    const w = await gh(`/contents/data/picks.json`, { method: "PUT", body: JSON.stringify(body) });
    if (w.ok) { S.picks = cur; return; }
    if (w.status !== 409 && w.status !== 422) throw new Error(`保存失败 ${w.status}`);
  }
  throw new Error("保存冲突，请重试");
}

// ---------- 渲染 ----------
function render() {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
  const acc = $("#account"); acc.textContent = S.token ? "已登录" : "登录"; acc.classList.toggle("ok", !!S.token);
  const v = $("#view");
  v.innerHTML = S.tab === "today" ? viewToday() : S.tab === "records" ? viewRecords() : viewStats();
}

function teamsHtml(m, mid) {
  return `<div class="teams"><div class="h">${esc(teamZh(m.home))}<span class="en">${esc(m.home)}</span></div>
    ${mid}<div class="a">${esc(teamZh(m.away))}<span class="en">${esc(m.away)}</span></div></div>`;
}
function barHtml(mk) {
  if (!mk) return `<div class="hint">赔率未到</div>`;
  const p = mk.probs;
  return `<div class="bar"><i class="ph" style="width:${p.h * 100}%"></i><i class="pd" style="width:${p.d * 100}%"></i><i class="pa" style="width:${p.a * 100}%"></i></div>
    <div class="barlbl"><span>主胜 ${pct(p.h)}</span><span>平 ${pct(p.d)}</span><span>客胜 ${pct(p.a)}</span></div>`;
}
function chipsHtml(m) {
  const L = lines(m), res = result(m);
  const one = (cls, label, t, extra = "") => {
    let st = "", mark = "";
    if (res && t) { st = same(t, res) ? " hit" : " miss"; mark = same(t, res) ? `<span class="mk pos">✓</span>` : ""; }
    return `<div class="chip ${cls}${st}"><small>${label}</small><b>${sc(t)}</b>${mark}${extra}</div>`;
  };
  const p = S.picks[m.id];
  const meExtra = p && p.skip ? `<small>跳过</small>` : (!p ? `<small>未选</small>` : "");
  const hm = L.mine && hedgeFor(m, "mine");
  return `<div class="lines">${one("mk", "盘口线", L.market)}${one("me", "我的线", L.mine, meExtra)}</div>${hm ? `<div class="hedge-line">${hedgeLine(hm)}</div>` : ""}`;
}
function hedgePickerHtml(m, d) {
  const chosen = (S.hedgeDraft || {})[m.id] || defaultSide(d);
  const btn = side => { const o = whOdds(m, side);
    return `<button class="hbtn ${chosen === side ? "on" : ""}" data-act="hedge" data-side="${side}" ${o ? "" : "disabled"}>${SIDE[side]}<small>${o ? `€${(STAKE / (o - 1)).toFixed(2)} · ${o.toFixed(2)}` : "未开盘"}</small></button>`; };
  return `<div class="hedge-pick"><span class="tag">对冲（${HEDGE_BOOK}）</span>${btn("over")}${btn("under")}
    <button class="hbtn ${chosen === "none" ? "on" : ""}" data-act="hedge" data-side="none">不对冲</button></div>`;
}
function card(m) {
  const res = result(m), started = Date.now() >= kt(m);
  const mid = res ? `<div class="vs res">${res[0]} : ${res[1]}</div>` : `<div class="vs">${started ? "进行中" : "vs"}</div>`;
  let bottom = "";
  if (revealed(m)) bottom = chipsHtml(m);
  if (!started && !S.picks[m.id] && m.market) {
    if (!S.token) bottom = `<div class="hint">登录后才能选比分。选好并锁定后，才会显示盘口线。</div>`;
    else {
      const d = S.draft[m.id] || [0, 0];
      bottom = `<div class="pick">
        <div class="stepper"><button data-act="dec" data-i="0">−</button><b>${d[0]}</b><button data-act="inc" data-i="0">+</button></div>
        <span class="colon">:</span>
        <div class="stepper"><button data-act="dec" data-i="1">−</button><b>${d[1]}</b><button data-act="inc" data-i="1">+</button></div>
        <div class="actions"><button class="btn ghost" data-act="skip">跳过</button><button class="btn" data-act="lock">锁定</button></div></div>
        ${hedgePickerHtml(m, d)}`;
    }
  }
  if (m.result && m.result.void) bottom += `<div class="hint">${esc(m.result.note || "无法结算")}</div>`;
  return `<div class="card" data-id="${esc(m.id)}">
    <div class="meta"><span><span class="lg">${LEAGUE[m.league] || ""}</span>${fTime.format(kt(m))}</span><span class="tag">详情 ›</span></div>
    ${teamsHtml(m, mid)}${barHtml(m.market)}${bottom}</div>`;
}
function grouped(list) {
  let out = "", last = "";
  for (const m of list) {
    const d = fDay.format(kt(m));
    if (d !== last) { out += `<div class="day">${d}</div>`; last = d; }
    out += card(m);
  }
  return out;
}
function viewToday() {
  const now = Date.now();
  const list = Object.values(S.matches).filter(m => !result(m) && !(m.result && m.result.void) && kt(m) > now - 3 * 3600e3)
    .sort((a, b) => kt(a) - kt(b));
  if (!list.length) return `<p class="empty">暂无即将开赛的比赛。<br>系统每天自动更新${S.updated ? `，最近一次：${fFull.format(Date.parse(S.updated))}` : ""}。</p>`;
  return grouped(list);
}
function viewRecords() {
  const now = Date.now();
  const list = Object.values(S.matches).filter(m => result(m) || (m.result && m.result.void) || kt(m) < now - 3 * 3600e3)
    .sort((a, b) => kt(b) - kt(a));
  if (!list.length) return `<p class="empty">还没有已结束的比赛。</p>`;
  let out = "", last = "";
  for (const m of list) {
    const d = fDay.format(kt(m));
    if (d !== last) { out += `<div class="day">${d}</div>`; last = d; }
    const res = result(m);
    out += `<div class="card" data-id="${esc(m.id)}"><div class="meta"><span><span class="lg">${LEAGUE[m.league] || ""}</span>${fTime.format(kt(m))}</span><span class="tag">详情 ›</span></div>
      ${teamsHtml(m, `<div class="vs ${res ? "res" : ""}">${res ? `${res[0]} : ${res[1]}` : "待结算"}</div>`)}${chipsHtml(m)}
      ${m.result && m.result.void ? `<div class="hint">${esc(m.result.note)}</div>` : ""}</div>`;
  }
  return out;
}

// ---------- 统计 ----------
function agg(items) { // items: [{p, hit}]
  const n = items.length, hits = items.filter(x => x.hit).length;
  let exp = 0, v = 0, rf = 0, rb = 0;
  for (const x of items) {
    exp += x.p; v += x.p * (1 - x.p);
    if (x.hit && x.p > 0) { const fair = 1 / x.p; rf += STAKE * fair; rb += STAKE * Math.max(1.01, fair * (1 - MARGIN)); }
  }
  const cost = STAKE * n;
  return { n, hits, exp, z: v > 0 ? (hits - exp) / Math.sqrt(v) : 0,
    roiF: n ? (rf - cost) / cost : 0, roiB: n ? (rb - cost) / cost : 0 };
}
function verdict(a) {
  if (a.n < 30) return ["样本太少", ""];
  if (a.z >= 2) return ["明显跑赢市场", "good"];
  if (a.z <= -2) return ["明显跑输市场", "bad"];
  return ["还不能确定", ""];
}
function settledList() {
  return Object.values(S.matches).filter(m => result(m) && m.market);
}
// 第二热门比分（不含 skip 指定的比分）
function topScoreExcept(mk, skip) {
  const g = matrix(mk.lam_h, mk.lam_a); let best = null, bp = -1;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) if (!same([i, j], skip) && g[i][j] > bp) { bp = g[i][j]; best = [i, j]; }
  return best;
}
// 规则线：盘口线，但遇到 1-1 改选第二热门比分
function no11(m) { const t = m.market && m.market.top; return t && same(t, [1, 1]) ? topScoreExcept(m.market, [1, 1]) : t; }
function itemsOf(list, pick) {
  const out = [];
  for (const m of list) { const t = pick(m); if (t) out.push({ m, t, p: pScore(m.market, t), hit: same(t, result(m)) }); }
  return out;
}
function itemsFor(list, key) {
  const out = [];
  for (const m of list) {
    const t = lines(m)[key]; if (!t) continue;
    out.push({ m, t, p: pScore(m.market, t), hit: same(t, result(m)) });
  }
  return out;
}
const signed = x => `<span class="${x >= 0 ? "pos" : "neg"}">${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%</span>`;
function overview(A) {
  const cols = [["盘口线", A.market], ["我的线", A.mine]];
  const r = (label, f) => `<tr><td>${label}</td>${cols.map(([, a]) => `<td>${a.n ? f(a) : "—"}</td>`).join("")}</tr>`;
  return `<div class="sec ov"><h3>两条线总览</h3><table>
    <tr><th></th>${cols.map(([t]) => `<th>${t}</th>`).join("")}</tr>
    ${r("命中 / 场数", a => `<b>${a.hits}</b>/${a.n}`)}
    ${r("市场预期命中", a => a.exp.toFixed(1))}
    ${r("命中率", a => pct(a.hits / a.n, 1))}
    ${r("ROI 公平", a => signed(a.roiF))}
    ${r("ROI 扣水", a => signed(a.roiB))}
    <tr><td>结论</td>${cols.map(([, a]) => { const [t, c] = verdict(a); return `<td class="vd ${c}">${t}</td>`; }).join("")}</tr>
  </table></div>`;
}
function row(label, a, b) {
  const cell = x => x.n ? `${x.hits}/${x.n}（预期 ${x.exp.toFixed(1)}）` : "—";
  return `<tr><td>${label}</td><td>${cell(a)}</td>${b ? `<td>${cell(b)}</td>` : ""}</tr>`;
}
function viewStats() {
  const all = settledList();
  const A = { market: agg(itemsFor(all, "market")), mine: agg(itemsFor(all, "mine")) };
  let out = `${overview(A)}
    <p class="hint">“市场预期”= 按 Pinnacle 概率，这条线本应命中的场数。命中数长期高于预期，才说明方法真的有效。ROI 按每场 €10 模拟：“公平”用无抽水赔率，“扣水”按博彩公司约 25% 抽水估算。</p>`;

  // 总进球对冲
  {
    const cols = [["盘口线", hedgeAgg(all, "market")], ["我的线", hedgeAgg(all, "mine")]];
    const r = (label, f) => `<tr><td>${label}</td>${cols.map(([, a]) => `<td>${a.n ? f(a) : "—"}</td>`).join("")}</tr>`;
    out += `<div class="sec ov"><h3>加总进球对冲后</h3><p>每场比分 €10，再配一注 William Hill 大/小 2.5 球，金额让对冲赢时刚好持平。盘口线自动选与比分互斥的一边；我的线按你锁定时的选择，不对冲的场次不计入。括号内为按概率的预期次数。</p><table>
      <tr><th></th>${cols.map(([t]) => `<th>${t}</th>`).join("")}</tr>
      ${r("比分命中", a => `<b>${a.hit}</b>（${a.eHit.toFixed(1)}）`)}
      ${r("对冲持平", a => `${a.even}（${a.eEven.toFixed(1)}）`)}
      ${r("全部失败", a => `${a.lose}（${a.eLose.toFixed(1)}）`)}
      ${r("总投入", a => `€${a.cost.toFixed(0)}`)}
      ${r("ROI 公平", a => signed(a.netF / a.cost))}
      ${r("ROI 扣水", a => signed(a.netB / a.cost))}
    </table></div>`;
  }

  // 按比分类型（两条线所选比分合并，同场同比分只算一次）
  const byScore = {};
  for (const m of all) {
    const seen = new Set();
    for (const k of ["market", "mine"]) {
      const t = lines(m)[k]; if (!t || seen.has(sc(t))) continue; seen.add(sc(t));
      (byScore[sc(t)] ||= []).push({ p: pScore(m.market, t), hit: same(t, result(m)) });
    }
  }
  const sr = Object.entries(byScore).sort((a, b) => b[1].length - a[1].length).slice(0, 10)
    .map(([s, it]) => row(s, agg(it))).join("");
  out += `<div class="sec"><h3>按比分类型</h3><p>某个比分长期命中少于预期，说明市场高估了它（例如检验 2-1 是否被压价）。</p>
    ${sr ? `<table><tr><th>比分</th><th>命中 / 次数</th></tr>${sr}</table>` : `<p>还没有数据。</p>`}</div>`;

  // 规则对比
  {
    const top11 = all.filter(m => same(m.market.top, [1, 1]));
    const conc = all.filter(m => m.market.top_p >= 0.12);
    const r = (label, a) => `<tr><td>${label}</td><td>${a.n ? `<b>${a.hits}</b>/${a.n}（预期 ${a.exp.toFixed(1)}）` : "—"}</td><td>${a.n ? signed(a.roiB) : "—"}</td></tr>`;
    out += `<div class="sec"><h3>规则对比</h3><p>只统计“如果当时按这条规则选”会怎样，不改变你的选法。ROI 为扣水后。</p>
      <h3 style="margin-top:10px">规则 1：实力接近时不选 1-1</h3><p>盘口线选到 1-1 的比赛，改选第二热门的比分。</p>
      <table><tr><th></th><th>命中 / 场数</th><th>ROI</th></tr>
      ${r("盘口线选 1-1 的场次：照选 1-1", agg(itemsOf(top11, m => m.market.top)))}
      ${r("同样场次：改选第二热门", agg(itemsOf(top11, m => topScoreExcept(m.market, [1, 1]))))}
      ${r("全部场次：盘口线", agg(itemsOf(all, m => m.market.top)))}
      ${r("全部场次：按规则 1", agg(itemsOf(all, no11)))}</table>
      <h3 style="margin-top:10px">规则 2：只买比分集中的比赛</h3><p>只算最热门比分概率 ≥12% 的场次（共 ${conc.length} 场），和全部场次对比。</p>
      <table><tr><th></th><th>命中 / 场数</th><th>ROI</th></tr>
      ${r("盘口线 · 集中场次", agg(itemsFor(conc, "market")))}
      ${r("盘口线 · 全部场次", agg(itemsFor(all, "market")))}
      ${r("我的线 · 集中场次", agg(itemsFor(conc, "mine")))}
      ${r("我的线 · 全部场次", agg(itemsFor(all, "mine")))}</table></div>`;
  }

  // 按集中度
  const bucket = m => m.market.top_p >= 0.12 ? "≥12%" : m.market.top_p >= 0.10 ? "10–12%" : "<10%";
  const bk = { "≥12%": [], "10–12%": [], "<10%": [] };
  for (const m of all) bk[bucket(m)].push(m);
  out += `<div class="sec"><h3>按比分集中度</h3><p>按“最热门比分的概率”分组：只买比分集中的比赛会不会更好。</p>
    <table><tr><th>集中度</th><th>盘口线</th><th>我的线</th></tr>
    ${Object.entries(bk).map(([k, l]) => row(k, agg(itemsFor(l, "market")), agg(itemsFor(l, "mine")))).join("")}</table></div>`;

  // 挑比赛
  const chosen = all.filter(m => pickOf(m));
  out += `<div class="sec"><h3>挑比赛有没有用</h3><p>同样用盘口线：Lee 选了的场次 vs 全部场次。</p>
    <table><tr><th></th><th>盘口线</th></tr>${row("Lee 选了的场次", agg(itemsFor(chosen, "market")))}${row("全部场次", A.market)}</table></div>`;

  // 系统状态
  const meta = S.meta || {}, logs = (meta.log || []).slice(-10).reverse().join("\n");
  out += `<div class="sec"><h3>系统状态</h3>
    <table><tr><td>最近运行</td><td>${meta.last_run ? fFull.format(Date.parse(meta.last_run.at)) : "—"}</td></tr>
    <tr><td>赔率接口剩余额度（本月）</td><td>${meta.credits_remaining ?? "—"} / 500</td></tr>
    <tr><td>比赛记录</td><td>${Object.keys(S.matches).length} 场</td></tr></table>
    <h3 style="margin-top:12px">运行日志</h3><div class="log">${esc(logs) || "—"}</div></div>`;
  return out;
}

// ---------- 详情 ----------
function openSheet(html) { const s = $("#sheet"); s.querySelector(".sheet-body").innerHTML = `<button class="close" data-act="close">×</button>` + html; s.hidden = false; }
function closeSheet() { $("#sheet").hidden = true; }

function detail(id) {
  const m = S.matches[id]; if (!m) return;
  const L = lines(m), rv = revealed(m), res = result(m), mk = m.market;
  let h = `<div class="meta"><span><span class="lg">${LEAGUE[m.league] || ""}</span>${fFull.format(kt(m))}</span></div>
    <h2>${esc(teamZh(m.home))} ${res ? `${res[0]} : ${res[1]}` : "vs"} ${esc(teamZh(m.away))}</h2>`;
  if (!mk) return openSheet(h + `<p class="hint">赔率未到。</p>`);
  h += barHtml(mk);
  if (!rv) h += `<p class="hint">选好比分并锁定（或跳过）后，才显示比分概率和盘口线，避免影响你的判断。</p>`;
  else {
    h += chipsHtml(m);
    h += L.mine ? hedgeHtml(m, "mine", "我的线") : hedgeHtml(m, "market", "盘口线");
    h += `<h3>预期进球</h3><table><tr><th></th><th>${esc(teamZh(m.home))}</th><th>${esc(teamZh(m.away))}</th></tr>
      <tr><td>盘口（${esc(mk.source)}）</td><td>${mk.lam_h.toFixed(2)}</td><td>${mk.lam_a.toFixed(2)}</td></tr></table>`;
    if (mk.total) h += `<p class="hint">大小球 ${mk.total.line}：大 ${mk.total.over} / 小 ${mk.total.under}</p>`;

    const g = matrix(mk.lam_h, mk.lam_a), mx = Math.max(...g.slice(0, 6).flatMap(r => r.slice(0, 6)));
    h += `<h3>比分概率（盘口）</h3><div class="grid"><div class="ax">主\\客</div>${[0,1,2,3,4,5].map(j => `<div class="ax">${j}</div>`).join("")}`;
    for (let i = 0; i < 6; i++) {
      h += `<div class="ax">${i}</div>`;
      for (let j = 0; j < 6; j++) {
        const t = [i, j], cls = ["c", same(t, L.market) ? "mk" : "", same(t, L.mine) ? "me" : ""].join(" ");
        h += `<div class="${cls}" style="--a:${(0.08 + 0.6 * g[i][j] / mx).toFixed(2)}">${(g[i][j] * 100).toFixed(1)}</div>`;
      }
    }
    h += `</div><div class="legend">单位 %。金框 = 盘口线，下划线 = 我的线。${L.mine ? `我的比分市场概率 ${pct(pScore(mk, L.mine), 1)}，公平赔率 ${(1 / pScore(mk, L.mine)).toFixed(1)}。` : ""}</div>`;
  }
  const books = Object.entries(m.books || {});
  if (books.length) {
    const best = k => Math.max(...books.map(([, x]) => x[k]));
    const bh = best("h"), bd = best("d"), ba = best("a");
    h += `<h3>各家胜平负赔率</h3><table><tr><th>庄家</th><th>主</th><th>平</th><th>客</th></tr>
      ${books.map(([k, x]) => `<tr><td>${BOOK[k] || esc(k)}</td><td class="${x.h === bh ? "best" : ""}">${x.h.toFixed(2)}</td><td class="${x.d === bd ? "best" : ""}">${x.d.toFixed(2)}</td><td class="${x.a === ba ? "best" : ""}">${x.a.toFixed(2)}</td></tr>`).join("")}</table>
      <div class="legend">金色 = 该项最高价。更新于 ${m.odds_at ? fFull.format(Date.parse(m.odds_at)) : "—"}</div>`;
  }
  openSheet(h);
}

// ---------- 登录 ----------
function accountSheet() {
  if (S.token) {
    openSheet(`<h2>已登录</h2><p class="hint">仓库：${esc(S.repo)}</p><p class="hint">令牌只保存在这台手机的浏览器里。</p>
      <button class="btn ghost" data-act="logout">退出登录</button>`);
    return;
  }
  openSheet(`<h2>登录</h2>
    <p class="hint">粘贴你在 GitHub 生成的访问令牌（只授权 duvaro-pro 仓库的 Contents 读写）。令牌只保存在这台手机上。</p>
    <input id="tok" type="password" placeholder="github_pat_…" autocomplete="off">
    <input id="repo" type="text" value="${esc(S.repo)}" placeholder="用户名/duvaro-pro">
    <button class="btn" data-act="login">登录</button>`);
}
async function login() {
  const tok = $("#tok").value.trim(), repo = $("#repo").value.trim();
  if (!tok) return toast("请粘贴令牌");
  const old = [S.token, S.repo]; S.token = tok; S.repo = repo;
  const r = await gh("").catch(() => null);
  if (!r || !r.ok) { [S.token, S.repo] = old; return toast(`令牌无效或无权访问 ${repo}`); }
  const j = await r.json();
  if (!j.permissions || !j.permissions.push) { [S.token, S.repo] = old; return toast("这个令牌没有写入权限（Contents 需选 Read and write）"); }
  lsSet("duvaro_token", tok); lsSet("duvaro_repo", repo);
  closeSheet(); toast("登录成功"); loadAll();
}

// ---------- 事件 ----------
document.addEventListener("click", async e => {
  const tab = e.target.closest(".tabs button");
  if (tab) { S.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (e.target.id === "account") return accountSheet();
  if (e.target.id === "sheet" || act === "close") return closeSheet();
  if (act === "login") return login();
  if (act === "logout") { lsSet("duvaro_token", null); S.token = null; closeSheet(); toast("已退出"); return loadAll(); }
  const cardEl = e.target.closest(".card");
  if (!cardEl) return;
  const id = cardEl.dataset.id, m = S.matches[id];
  if (act === "inc" || act === "dec") {
    const i = +e.target.closest("[data-i]").dataset.i, d = (S.draft[id] ||= [0, 0]);
    d[i] = Math.max(0, Math.min(9, d[i] + (act === "inc" ? 1 : -1)));
    cardEl.querySelectorAll(".stepper b").forEach((b, k) => (b.textContent = d[k])); // 只改数字，不重画页面
    const hp = cardEl.querySelector(".hedge-pick"); if (hp) hp.outerHTML = hedgePickerHtml(m, d); // 对冲默认边随比分更新
    return;
  }
  if (act === "hedge") {
    S.hedgeDraft[id] = e.target.closest("[data-side]").dataset.side;
    const hp = cardEl.querySelector(".hedge-pick"); if (hp) hp.outerHTML = hedgePickerHtml(m, S.draft[id] || [0, 0]);
    return;
  }
  if (act === "lock" || act === "skip") {
    if (Date.now() >= kt(m)) return toast("已经开赛，不能再选");
    const d = S.draft[id] || [0, 0];
    let side = S.hedgeDraft[id] || defaultSide(d), hOdds = side !== "none" ? whOdds(m, side) : null;
    if (side !== "none" && !hOdds) side = "none";
    const hTxt = side === "none" ? "不对冲" : `对冲 ${SIDE[side]} €${(STAKE / (hOdds - 1)).toFixed(2)}（${hOdds.toFixed(2)}）`;
    const ok = act === "lock" ? confirm(`锁定 ${teamZh(m.home)} ${d[0]} : ${d[1]} ${teamZh(m.away)}？\n${hTxt}\n锁定后不能修改。`) : confirm("跳过这场？跳过后不能再选。");
    if (!ok) return;
    const btns = cardEl.querySelectorAll(".btn"); btns.forEach(b => (b.disabled = true));
    try {
      await savePick(id, act === "lock" ? { h: d[0], a: d[1], hedge: side, hedge_odds: hOdds, hedge_book: hOdds ? HEDGE_BOOK : null, locked_at: new Date().toISOString() } : { skip: true, locked_at: new Date().toISOString() });
      toast(act === "lock" ? "已锁定，系统答案已揭晓" : "已跳过");
    } catch (err) { toast(err.message || "保存失败"); }
    render(); return;
  }
  detail(id);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAll(); });
loadAll();
