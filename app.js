"use strict";
// Duvaro Pro 前端。数据来自仓库 data/ 目录；Lee 的预测写回 data/picks.json。

const RHO = -0.08;          // 必须与 scripts/model.py 一致
const STAKE = 10;           // 每场模拟 €10
const MARGIN = 0.25;        // 博彩公司正确比分约 25% 抽水
const N = 11;
const TZ = "Europe/Dublin";
const LEAGUE = { laliga: "西甲", seriea: "意甲" };
const BOOK = { pinnacle: "Pinnacle", paddypower: "Paddy Power", boylesports: "BoyleSports",
  betfair_ex_uk: "Betfair 交易所", williamhill: "William Hill", skybet: "Sky Bet",
  ladbrokes_uk: "Ladbrokes", betvictor: "BetVictor", unibet_uk: "Unibet", smarkets: "Smarkets" };
const CAT = { injury: "伤停", suspension: "停赛", lineup: "首发/轮换", form: "状态/xG",
  schedule: "赛程/体能", motivation: "比赛动机", coach: "主帅/战术", other: "其他" };
const CONF = { high: "高", medium: "中", low: "低" };

const S = { matches: {}, picks: {}, meta: {}, updated: null, tab: "today", draft: {},
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
function pScore(mk, t) { return t && t[0] < N && t[1] < N ? matrix(mk.lam_h, mk.lam_a)[t[0]][t[1]] : 0; }

// ---------- 三条线 ----------
function pickOf(m) {
  const p = S.picks[m.id]; if (!p || p.skip || p.h == null) return null;
  if (p.locked_at && Date.parse(p.locked_at) > kt(m)) return null; // 开赛后锁定的不算
  return [p.h, p.a];
}
function lines(m) {
  const ai = m.ai && m.ai.status === "ok" ? m.ai.top : null;
  return { market: m.market ? m.market.top : null, ai, aiOrMarket: ai || (m.market && m.market.top), mine: pickOf(m) };
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
  const aiExtra = m.ai && m.ai.status === "failed" ? `<small>分析失败</small>` : (!m.ai ? `<small>待分析</small>` : "");
  const meExtra = p && p.skip ? `<small>跳过</small>` : (!p ? `<small>未选</small>` : "");
  return `<div class="lines">${one("mk", "盘口线", L.market)}${one("ai", "AI 线", L.ai, aiExtra)}${one("me", "我的线", L.mine, meExtra)}</div>`;
}
function card(m) {
  const res = result(m), started = Date.now() >= kt(m);
  const mid = res ? `<div class="vs res">${res[0]} : ${res[1]}</div>` : `<div class="vs">${started ? "进行中" : "vs"}</div>`;
  let bottom = "";
  if (revealed(m)) bottom = chipsHtml(m);
  if (!started && !S.picks[m.id] && m.market) {
    if (!S.token) bottom = `<div class="hint">登录后才能选比分。选好并锁定后，才会显示盘口线和 AI 线。</div>`;
    else {
      const d = S.draft[m.id] || [0, 0];
      bottom = `<div class="pick">
        <div class="stepper"><button data-act="dec" data-i="0">−</button><b>${d[0]}</b><button data-act="inc" data-i="0">+</button></div>
        <span class="colon">:</span>
        <div class="stepper"><button data-act="dec" data-i="1">−</button><b>${d[1]}</b><button data-act="inc" data-i="1">+</button></div>
        <div class="actions"><button class="btn ghost" data-act="skip">跳过</button><button class="btn" data-act="lock">锁定</button></div></div>`;
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
  const cols = [["盘口线", A.market], ["AI 线", A.ai], ["我的线", A.mine]];
  const r = (label, f) => `<tr><td>${label}</td>${cols.map(([, a]) => `<td>${a.n ? f(a) : "—"}</td>`).join("")}</tr>`;
  return `<div class="sec ov"><h3>三条线总览</h3><table>
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
  const A = { market: agg(itemsFor(all, "market")), ai: agg(itemsFor(all, "aiOrMarket")), mine: agg(itemsFor(all, "mine")) };
  let out = `${overview(A)}
    <p class="hint">“市场预期”= 按 Pinnacle 概率，这条线本应命中的场数。命中数长期高于预期，才说明方法真的有效。ROI 按每场 €10 模拟：“公平”用无抽水赔率，“扣水”按博彩公司约 25% 抽水估算。</p>`;

  // AI 改了比分的场次
  const changed = all.filter(m => m.ai && m.ai.status === "ok" && !same(m.ai.top, m.market.top));
  out += `<div class="sec"><h3>AI 改了比分的场次</h3><p>只看 AI 和盘口选了不同比分的比赛，场外信息有没有用一目了然。</p>
    <table><tr><th></th><th>命中 / 场数</th></tr>${row("AI 线", agg(itemsFor(changed, "ai")))}${row("盘口线", agg(itemsFor(changed, "market")))}</table></div>`;

  // 按调整类别
  const cats = {};
  for (const m of all) for (const a of (m.ai && m.ai.status === "ok" && m.ai.adjustments) || []) (cats[a.category] ||= new Set()).add(m);
  let cr = "";
  for (const [c, set] of Object.entries(cats)) { const l = [...set]; cr += row(CAT[c] || c, agg(itemsFor(l, "ai")), agg(itemsFor(l, "market"))); }
  out += `<div class="sec"><h3>按 AI 调整类别</h3><p>哪类场外信息真正有用：同一批比赛上 AI 线和盘口线的对比。</p>
    ${cr ? `<table><tr><th>类别</th><th>AI 线</th><th>盘口线</th></tr>${cr}</table>` : `<p>还没有数据。</p>`}</div>`;

  // 按比分类型（三条线所选比分合并，同场同比分只算一次）
  const byScore = {};
  for (const m of all) {
    const seen = new Set();
    for (const k of ["market", "ai", "mine"]) {
      const t = lines(m)[k]; if (!t || seen.has(sc(t))) continue; seen.add(sc(t));
      (byScore[sc(t)] ||= []).push({ p: pScore(m.market, t), hit: same(t, result(m)) });
    }
  }
  const sr = Object.entries(byScore).sort((a, b) => b[1].length - a[1].length).slice(0, 10)
    .map(([s, it]) => row(s, agg(it))).join("");
  out += `<div class="sec"><h3>按比分类型</h3><p>某个比分长期命中少于预期，说明市场高估了它（例如检验 2-1 是否被压价）。</p>
    ${sr ? `<table><tr><th>比分</th><th>命中 / 次数</th></tr>${sr}</table>` : `<p>还没有数据。</p>`}</div>`;

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
  const failed = Object.values(S.matches).filter(m => m.ai && m.ai.status === "failed").length;
  out += `<div class="sec"><h3>系统状态</h3>
    <table><tr><td>最近运行</td><td>${meta.last_run ? fFull.format(Date.parse(meta.last_run.at)) : "—"}</td></tr>
    <tr><td>赔率接口剩余额度（本月）</td><td>${meta.credits_remaining ?? "—"} / 500</td></tr>
    <tr><td>比赛记录</td><td>${Object.keys(S.matches).length} 场</td></tr>
    <tr><td>AI 分析失败待重试</td><td>${failed} 场</td></tr></table>
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
  if (!rv) h += `<p class="hint">选好比分并锁定（或跳过）后，才显示比分概率、盘口线和 AI 分析，避免影响你的判断。</p>`;
  else {
    h += chipsHtml(m);
    h += `<h3>预期进球</h3><table><tr><th></th><th>${esc(teamZh(m.home))}</th><th>${esc(teamZh(m.away))}</th></tr>
      <tr><td>盘口（${esc(mk.source)}）</td><td>${mk.lam_h.toFixed(2)}</td><td>${mk.lam_a.toFixed(2)}</td></tr>
      ${m.ai && m.ai.status === "ok" ? `<tr><td>AI 修正后</td><td>${m.ai.lam_h.toFixed(2)}</td><td>${m.ai.lam_a.toFixed(2)}</td></tr>` : ""}</table>`;
    if (mk.total) h += `<p class="hint">大小球 ${mk.total.line}：大 ${mk.total.over} / 小 ${mk.total.under}</p>`;

    const g = matrix(mk.lam_h, mk.lam_a), mx = Math.max(...g.slice(0, 6).flatMap(r => r.slice(0, 6)));
    h += `<h3>比分概率（盘口）</h3><div class="grid"><div class="ax">主\\客</div>${[0,1,2,3,4,5].map(j => `<div class="ax">${j}</div>`).join("")}`;
    for (let i = 0; i < 6; i++) {
      h += `<div class="ax">${i}</div>`;
      for (let j = 0; j < 6; j++) {
        const t = [i, j], cls = ["c", same(t, L.market) ? "mk" : "", same(t, L.ai) ? "ai" : "", same(t, L.mine) ? "me" : ""].join(" ");
        h += `<div class="${cls}" style="--a:${(0.08 + 0.6 * g[i][j] / mx).toFixed(2)}">${(g[i][j] * 100).toFixed(1)}</div>`;
      }
    }
    h += `</div><div class="legend">单位 %。金框 = 盘口线，蓝框 = AI 线，下划线 = 我的线。${L.mine ? `我的比分市场概率 ${pct(pScore(mk, L.mine), 1)}，公平赔率 ${(1 / pScore(mk, L.mine)).toFixed(1)}。` : ""}</div>`;

    h += `<h3>AI 分析</h3>`;
    const ai = m.ai;
    if (!ai) h += `<p class="hint">还没分析（开赛前 30 小时内自动分析）。</p>`;
    else if (ai.status === "failed") h += `<p class="hint">分析失败，系统会自动重试（第 ${ai.tries} 次）。原因：${esc(ai.error)}</p>`;
    else {
      h += `<p>${esc(ai.summary)} <span class="tag">信心：${CONF[ai.confidence] || "—"}${ai.searched === false ? " · 未找到相关新闻" : ""}</span></p>`;
      if (!ai.adjustments.length) h += `<p class="hint">没有找到盘口之外的可靠信息，AI 线 = 盘口线。</p>`;
      for (const a of ai.adjustments) {
        const who = esc(teamZh(a.team === "home" ? m.home : m.away)), up = a.delta > 0;
        h += `<div class="adj"><span class="d ${up ? "up" : "dn"}">${up ? "+" : ""}${a.delta.toFixed(2)} 球</span>
          <span class="cat">${CAT[a.category] || a.category}</span>${who}：${esc(a.reason)}
          ${a.source ? `<div class="tag">来源：${safeUrl(a.source) ? `<a href="${safeUrl(a.source)}" target="_blank" rel="noopener">${esc(a.source.slice(0, 60))}</a>` : esc(a.source)}</div>` : ""}</div>`;
      }
      if (ai.sources && ai.sources.length) {
        h += `<h3>AI 参考的新闻（最近 7 天）</h3>`;
        for (const side of ["home", "away"]) {
          const items = ai.sources.filter(x => (x.team || "home") === side);
          if (!items.length) continue;
          h += `<div class="tag" style="margin:6px 0 2px">${esc(teamZh(side === "home" ? m.home : m.away))}</div>`;
          h += items.map(x => `<div class="adj"><span class="tag">${esc(x.date || "")} · ${safeUrl(x.url) ? `<a href="${safeUrl(x.url)}" target="_blank" rel="noopener">${esc(x.source)}</a>` : esc(x.source || "")}</span><br>${esc(x.title)}</div>`).join("");
        }
      }
      h += `<div class="tag">分析时间：${fFull.format(Date.parse(ai.at))}</div>`;
    }
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
    return;
  }
  if (act === "lock" || act === "skip") {
    if (Date.now() >= kt(m)) return toast("已经开赛，不能再选");
    const d = S.draft[id] || [0, 0];
    const ok = act === "lock" ? confirm(`锁定 ${teamZh(m.home)} ${d[0]} : ${d[1]} ${teamZh(m.away)}？\n锁定后不能修改。`) : confirm("跳过这场？跳过后不能再选。");
    if (!ok) return;
    const btns = cardEl.querySelectorAll(".btn"); btns.forEach(b => (b.disabled = true));
    try {
      await savePick(id, act === "lock" ? { h: d[0], a: d[1], locked_at: new Date().toISOString() } : { skip: true, locked_at: new Date().toISOString() });
      toast(act === "lock" ? "已锁定，系统答案已揭晓" : "已跳过");
    } catch (err) { toast(err.message || "保存失败"); }
    render(); return;
  }
  detail(id);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAll(); });
loadAll();
