/* ===========================================================================
app.js - logika stranky Skladove hladiny

Tok:
1. Nacte seznam behu (/api/runs) a naplni vyber. Vybere nejnovejsi.
2. Pro vybrany beh nacte souhrn (/api/summary) -> karty rozdeleni,
a radky (/api/vypocet) -> tabulka.
3. Klik na radek nacte detail (/api/material) a otevre "drawer" s
VIZUALIZACI VYPOCTU: graf tydennich potreb, zvyraznene 4tydenni okno,
prepocet na 2denni hladinu a rozpis vypoctu.

API klic tady zamerne NENI - frontend mluvi jen s vlastnim app-backendem
(server/routes/index.js), ten teprve prida klic a zavola sql-connector.
Appka data cte; jediny zapis je nastaveni/zruseni vyjimky.
=========================================================================== */

'use strict';

(function () {
const CFG = window.APP_CONFIG || {};
const API_BASE = CFG.API_BASE || './api';
const WINDOW_START = Number.isFinite(CFG.WINDOW_START) ? CFG.WINDOW_START : 1;
const WINDOW_LEN = Number.isFinite(CFG.WINDOW_LEN) ? CFG.WINDOW_LEN : 4;
const BAND = Number.isFinite(CFG.BAND) ? CFG.BAND : 0.2;
let PAGE_SIZE = 50;

// --- prvky DOM ---
const runSelect = document.getElementById('runSelect');
const runMeta = document.getElementById('runMeta');
const refreshBtn = document.getElementById('refreshBtn');
const statusEl = document.getElementById('status');

const summarySection = document.getElementById('summarySection');
const sumGrid = document.getElementById('sumGrid');
const sumTotal = document.getElementById('sumTotal');

const tableSection = document.getElementById('tableSection');
const activeFilterEl = document.getElementById('activeFilter');
const rowCountEl = document.getElementById('rowCount');
const whBody = document.getElementById('whBody');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');

const drawer = document.getElementById('drawer');
const drawerBackdrop = document.getElementById('drawerBackdrop');
const drawerClose = document.getElementById('drawerClose');
const drawerTitle = document.getElementById('drawerTitle');
const drawerBody = document.getElementById('drawerBody');

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// --- stav ---
let currentRunAt = '';
let allRows = [];
let sortKey = 'action_label';
let sortDir = 1; // 1 = asc, -1 = desc

let actionFilter = null; // drzi se kvuli propojeni s kartami souhrnu
let colFilters = {}; // { key: Set(zobrazenych hodnot) } - prazdne = bez filtru
let xlKey = null; // sloupec, jehoz filtr je prave otevreny
let lastSummary = [];
let page = 1;

/* ============================ pomocnici ============================ */

function escapeHtml(v) {
return String(v == null ? '' : v)
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const nf0 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const nf3 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 3 });

// Desetinny format - pouziva se VYHRADNE v rozpisu vypoctu Q3, kde by
// zaokrouhleni nahoru rozbilo aritmetiku (28 + 0,25 x 15 != 32).
function fmtDec(v) {
if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
return nf3.format(Number(v));
}

// Vsechna mnozstvi se zobrazuji jako cela cisla zaokrouhlena NAHORU
// (kus navic je vzdy lepsi nez kus chybejici). Parametr dec uz nema vliv -
// zustava jen kvuli kompatibilite se starsimi volanimi.
function fmt(v, dec) {
if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
return nf0.format(Math.ceil(Number(v)));
}

function fmtPct(v) {
if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
const p = Number(v) * 100;
const sign = p > 0 ? '+' : '';
return `${sign}${p.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`;
}

function fmtDateTime(iso) {
if (!iso) return '—';
const d = new Date(iso);
if (Number.isNaN(d.getTime())) return String(iso);
return d.toLocaleString('cs-CZ', {
day: '2-digit', month: '2-digit', year: 'numeric',
hour: '2-digit', minute: '2-digit',
});
}

// Zatrideni slovniho duvodu do barevne kategorie.
function actionKind(label) {
const s = (label || '').toLowerCase();
if (s.includes('navýš')) return 'up';
if (s.includes('poníž') || s.includes('poniz')) return 'down';
if (s.includes('mrtv')) return 'dead';
if (s.includes('nov')) return 'new';
return 'flat';
}
const KIND_COLOR = {
up: 'var(--up)', down: 'var(--down)', flat: 'var(--flat)',
dead: 'var(--dead)', new: 'var(--new)',
};

function setStatus(text, typ) {
statusEl.textContent = text || '';
statusEl.className = 'status' + (typ ? ' status-' + typ : '');
}

async function apiGet(path) {
const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
const body = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(body.error || `Server odpověděl chybou ${res.status}.`);
return body;
}

/* ============================ nacitani ============================ */

async function init() {
setStatus('Načítám běhy…', 'loading');
try {
const runs = await apiGet('/runs');
if (!runs.length) {
setStatus('Zatím není žádný běh výpočtu. Spusť proceduru usp_vypocet_hladin.', 'empty');
return;
}
runSelect.innerHTML = runs.map((r) => {
const zmeny = r.pocet_zmen != null ? `, ${r.pocet_zmen} změn` : '';
return `<option value="${escapeHtml(r.run_at)}">${escapeHtml(fmtDateTime(r.run_at))} · ${escapeHtml(String(r.pocet_celkem))} mat.${escapeHtml(zmeny)}</option>`;
}).join('');
currentRunAt = runs[0].run_at;
await loadRun(currentRunAt);
} catch (err) {
setStatus(`Chyba: ${err.message}`, 'error');
}
}

async function loadRun(runAt) {
setStatus('Načítám výpočet…', 'loading');
summarySection.hidden = true;
tableSection.hidden = true;
try {
const [summary, vypocet] = await Promise.all([
apiGet(`/summary?run_at=${encodeURIComponent(runAt)}`),
apiGet(`/vypocet?run_at=${encodeURIComponent(runAt)}`),
]);

currentRunAt = vypocet.run_at || runAt;
allRows = vypocet.data || [];

renderSummary(summary);
populateTypeFilter();

// reset filtru/strankovani pri zmene behu
actionFilter = null;
page = 1;
renderTable();

summarySection.hidden = false;
tableSection.hidden = false;

const zmeny = allRows.filter(
(r) => r.new_level != null && (r.current_level == null || Number(r.new_level) !== Number(r.current_level))
).length;
setStatus(`Běh ${fmtDateTime(currentRunAt)} — ${allRows.length} materiálů, z toho ${zmeny} navržených změn.`, 'ok');
runMeta.textContent = '';
nactiZdroje();
} catch (err) {
setStatus(`Chyba: ${err.message}`, 'error');
}
}

/* ============================ souhrn ============================ */

function renderSummary(summary) {
lastSummary = summary || [];
const total = lastSummary.reduce((a, x) => a + Number(x.pocet || 0), 0);
sumTotal.textContent = `${nf0.format(total)} materiálů`;

const max = Math.max(1, ...lastSummary.map((x) => Number(x.pocet || 0)));
// seradime od nejcetnejsiho, at je hned videt, co dominuje
const rows = lastSummary.slice().sort((a, b) => Number(b.pocet || 0) - Number(a.pocet || 0));

sumGrid.innerHTML = rows.map((x) => {
const kind = actionKind(x.action_label);
const pocet = Number(x.pocet || 0);
const pct = total ? (pocet / total) * 100 : 0;
const active = actionFilter === x.action_label ? ' active' : '';
return `<button type="button" class="sum-card${active}" data-label="${escapeHtml(x.action_label)}" style="--c:${KIND_COLOR[kind]}">
<span class="sum-card-top">
<span class="sum-card-n">${nf0.format(pocet)}</span>
<span class="sum-card-pct">${pct.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %</span>
</span>
<span class="sum-card-label">${escapeHtml(x.action_label)}</span>
<span class="sum-card-track"><span class="sum-card-fill" style="width:${(pocet / max) * 100}%"></span></span>
</button>`;
}).join('');

sumGrid.querySelectorAll('.sum-card').forEach((btn) => {
btn.addEventListener('click', () => {
const label = btn.getAttribute('data-label');
actionFilter = actionFilter === label ? null : label;
page = 1;
if (actionFilter) colFilters.action_label = new Set([actionFilter]);
else delete colFilters.action_label;
renderSummary(lastSummary);
renderTable();
});
});
}

/* ============================ tabulka ============================ */

function currentRows() {
let rows = allRows.filter((r) => FILTER_COLS.every((k) => {
const sel = colFilters[k];
return !sel || sel.has(cellText(r, k));
}));

const numeric = new Set(['current_level', 'new_level', 'pct_change']);
rows = rows.slice().sort((a, b) => {
let va = a[sortKey], vb = b[sortKey];
if (numeric.has(sortKey)) {
va = va == null ? -Infinity : Number(va);
vb = vb == null ? -Infinity : Number(vb);
return (va - vb) * sortDir;
}
return String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'cs', { numeric: true }) * sortDir;
});
return rows;
}

function renderTable() {
const rows = currentRows();
const size = PAGE_SIZE === 'all' ? Math.max(rows.length, 1) : PAGE_SIZE;
const pages = Math.max(1, Math.ceil(rows.length / size));
if (page > pages) page = pages;
const start = (page - 1) * size;
const pageRows = rows.slice(start, start + size);

if (!rows.length) {
whBody.innerHTML = `<tr><td colspan="7" class="wh-message">Žádné řádky neodpovídají filtru.</td></tr>`;
} else {
whBody.innerHTML = pageRows.map((r) => {
const kind = actionKind(r.action_label);
const pctCls = r.pct_change > 0 ? 'pct-up' : r.pct_change < 0 ? 'pct-down' : 'muted';
return `<tr data-material="${escapeHtml(r.material)}">
<td class="mat-cell">${escapeHtml(r.material)}</td>
<td class="num">${fmt(r.current_level)}</td>
<td class="num">${r.new_level == null ? '<span class="muted">—</span>' : fmt(r.new_level)}</td>
<td class="num ${pctCls}">${fmtPct(r.pct_change)}</td>
<td><span class="badge badge-${kind}">${escapeHtml(r.action_label)}</span></td>
<td class="muted">${escapeHtml(r.storage_type || '—')}</td>
<td class="col-exc"><input type="checkbox" class="exc-box" data-material="${escapeHtml(r.material)}"${r.is_vyjimka ? ' checked' : ''} title="Vyloučit z automatické kalkulace"></td>
</tr>`;
}).join('');

whBody.querySelectorAll('tr[data-material]').forEach((tr) => {
tr.addEventListener('click', (e) => {
if (e.target.closest('.col-exc')) return; // klik na checkbox neotvira detail
openDetail(tr.getAttribute('data-material'));
});
});
whBody.querySelectorAll('.exc-box').forEach((box) => {
box.addEventListener('change', () => ulozVyjimku(box.getAttribute('data-material'), box.checked, box));
});
}

syncMaster();
markActiveFilters();
rowCountEl.textContent = `${nf0.format(rows.length)} ${rows.length === 1 ? 'řádek' : rows.length >= 2 && rows.length <= 4 ? 'řádky' : 'řádků'}`;
pageInfo.textContent = `Strana ${page} / ${pages}`;
prevPage.disabled = page <= 1;
nextPage.disabled = page >= pages;

if (actionFilter) {
activeFilterEl.hidden = false;
activeFilterEl.innerHTML = `Filtr: ${escapeHtml(actionFilter)} <button type="button" title="Zrušit filtr">×</button>`;
activeFilterEl.querySelector('button').addEventListener('click', () => {
actionFilter = null;
delete colFilters.action_label;
page = 1;
if (lastSummary.length) renderSummary(lastSummary);
renderTable();
});
} else {
activeFilterEl.hidden = true;
activeFilterEl.innerHTML = '';
}

// vizualni stav razeni v hlavicce
document.querySelectorAll('th.sortable').forEach((th) => {
th.classList.remove('sort-asc', 'sort-desc');
if (th.getAttribute('data-key') === sortKey) {
th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
}
});
}

/* ==================== DETAIL + VIZUALIZACE VYPOCTU ==================== */

// Orientacni tydenni kvartil Q3 (interpolace, dle obecneho vysvetleni) -
// slouzi POUZE k umisteni carky v grafu a k rozpisu vypoctu.
// Autoritativni vysledek je q3 z DB.
function weeklyQ3(values) {
const v = values.filter((x) => x > 0).slice().sort((a, b) => a - b);
const n = v.length;
if (n === 0) return null;
if (n === 1) return v[0];
const pos = 0.75 * (n - 1);
const lo = Math.floor(pos);
const hi = Math.ceil(pos);
if (lo === hi) return v[lo];
return v[lo] + (pos - lo) * (v[hi] - v[lo]);
}

// SVG sloupcovy graf potreb se zvyraznenym oknem. Parametrizovany:
// opts.factor - prepocet hodnot (1 = tydenni, 2/7 = 2denni ekvivalent)
// opts.qLine - hodnota vodorovne Q3 cary (uz v jednotkach grafu), nebo null
// opts.qSolid - true = plna cara (autoritativni q3), false = carkovana
function demandChartSvg(potreby, opts) {
opts = opts || {};
const factor = opts.factor || 1;
const qLine = (opts.qLine != null && isFinite(opts.qLine)) ? Math.ceil(Number(opts.qLine)) : null;
const qSolid = !!opts.qSolid;
const W = 640, H = 220, padL = 28, padR = 12, padT = 16, padB = 40;
const plotW = W - padL - padR, plotH = H - padT - padB;
const baseY = padT + plotH;

const rows = potreby.slice().sort((a, b) => a.period_index - b.period_index);
if (!rows.length) return '<p class="note">Týdenní potřeby pro tento materiál nejsou v aktuálním importu.</p>';

const maxVal = Math.max(1, ...rows.map((r) => Math.ceil((Number(r.requirement_qty) || 0) * factor)), qLine || 0);
const n = rows.length;
const slot = plotW / n;
const bw = Math.min(26, slot * 0.62);

const winEnd = WINDOW_START + WINDOW_LEN - 1;
let bars = '';
let labels = '';
let hits = '';
rows.forEach((r, i) => {
const val = Math.ceil((Number(r.requirement_qty) || 0) * factor);
const x = padL + slot * i + (slot - bw) / 2;
const h = (val / maxVal) * plotH;
const y = baseY - h;
const inWin = r.period_index >= WINDOW_START && r.period_index <= winEnd;
const color = val <= 0 ? '#e6ebe8' : inWin ? 'var(--brand)' : '#c3d0c8';
bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, val > 0 ? 2 : 0).toFixed(1)}" rx="2" fill="${color}"></rect>`;
// popisek tydne (zkraceny na cislo tydne z "cw 37/2026")
const short = String(r.period_label || r.period_index).replace(/^cw\s*/i, '').split('/')[0];
const cx = padL + slot * i + slot / 2;
labels += `<text x="${cx.toFixed(1)}" y="${(baseY + 14).toFixed(1)}" text-anchor="middle" font-size="16" fill="${inWin ? 'var(--brand-dark)' : '#96a19a'}">${escapeHtml(short)}</text>`;
// neviditelna "hit" zona pres cely tydenni sloupec - kvuli tenkym sloupcum
// se snadno trefi hover; nese data pro tooltip (tyden + hodnota).
hits += `<rect class="wh-bar-hit" data-week="${escapeHtml(String(r.period_label || ('týden ' + r.period_index)))}" data-val="${val}" data-inwin="${inWin ? '1' : '0'}" x="${(padL + slot * i).toFixed(1)}" y="${padT.toFixed(1)}" width="${slot.toFixed(1)}" height="${plotH.toFixed(1)}"></rect>`;
});

// vyznaceni okna (podklad)
let winRect = '';
const idxs = rows.map((r) => r.period_index);
const firstWin = rows.findIndex((r) => r.period_index >= WINDOW_START);
const lastWin = idxs.reduce((acc, v, i) => (v <= winEnd && v >= WINDOW_START ? i : acc), -1);
if (firstWin !== -1 && lastWin >= firstWin) {
const wx = padL + slot * firstWin + 2;
const ww = slot * (lastWin - firstWin + 1) - 4;
winRect = `<rect x="${wx.toFixed(1)}" y="${padT}" width="${ww.toFixed(1)}" height="${plotH}" fill="rgba(0,137,61,.15)" rx="6"></rect>`;
}

// vodorovna Q3 cara (volitelna)
let q3line = '';
if (qLine != null && qLine > 0) {
const qy = baseY - (qLine / maxVal) * plotH;
const col = qSolid ? 'var(--brand-dark)' : 'var(--down)';
const dash = qSolid ? '' : ' stroke-dasharray="5 4"';
q3line = `<line x1="${padL}" y1="${qy.toFixed(1)}" x2="${W - padR}" y2="${qy.toFixed(1)}" stroke="${col}" stroke-width="1.6"${dash}></line>`
+ `<text x="${(W - padR).toFixed(1)}" y="${(qy - 4).toFixed(1)}" text-anchor="end" font-size="16" font-weight="700" fill="${col}">Q3 ${escapeHtml(fmt(qLine))}</text>`;
}

return `<svg class="wh-demand-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Graf týdenních potřeb">
${winRect}
<line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="var(--line)" stroke-width="1"></line>
${bars}
${q3line}
${labels}
${hits}
</svg>`;
}

// Mini pasmo ±BAND kolem aktualni hladiny + poloha q3.
// Ponechano pro pripadne znovupouziti - v detailu se aktualne nevykresluje.
function bandBarSvg(current, q3) {
const cur = Number(current);
const q = Number(q3);
if (!Number.isFinite(cur) || cur <= 0 || !Number.isFinite(q)) return '';
const lo = cur * (1 - BAND), hi = cur * (1 + BAND);
const domainLo = Math.min(lo, q) * 0.9;
const domainHi = Math.max(hi, q) * 1.05;
const span = domainHi - domainLo || 1;
const W = 560, H = 64, padL = 10, padR = 10;
const plotW = W - padL - padR, y = 30;
const xOf = (v) => padL + ((v - domainLo) / span) * plotW;

const bandX = xOf(lo), bandW = xOf(hi) - xOf(lo);
const qx = xOf(q), cx = xOf(cur);

return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pásmo tolerance a poloha nové hladiny">
<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--line)" stroke-width="2"></line>
<rect x="${bandX.toFixed(1)}" y="${y - 8}" width="${bandW.toFixed(1)}" height="16" rx="8" fill="rgba(138,147,142,.22)"></rect>
<line x1="${cx.toFixed(1)}" y1="${y - 12}" x2="${cx.toFixed(1)}" y2="${y + 12}" stroke="var(--flat)" stroke-width="2"></line>
<text x="${cx.toFixed(1)}" y="${y + 26}" text-anchor="middle" font-size="10" fill="var(--ink-soft)">aktuální</text>
<circle cx="${qx.toFixed(1)}" cy="${y}" r="6" fill="var(--brand)"></circle>
<text x="${qx.toFixed(1)}" y="${y - 16}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--brand-dark)">Q3 → ${escapeHtml(fmt(q))}</text>
</svg>`;
}

function stepsHtml(vp, potreby) {
const winEnd = WINDOW_START + WINDOW_LEN - 1;
const winRows = potreby
.filter((r) => r.period_index >= WINDOW_START && r.period_index <= winEnd)
.sort((a, b) => a.period_index - b.period_index);
const winLabels = winRows.map((r) => (r.period_label || `t${r.period_index}`)).join(', ') || '—';
const nonZero = winRows.map((r) => Number(r.requirement_qty) || 0).filter((x) => x > 0).sort((a, b) => a - b);
const q3w = weeklyQ3(winRows.map((r) => Number(r.requirement_qty) || 0));

const li = [];

li.push(`Okno <b>${WINDOW_LEN}</b> týdnů: ${escapeHtml(winLabels)}`);

li.push(nonZero.length
? `Vynecháme nulové týdny a seřadíme → zůstává <b>${nonZero.length}</b> hodnot: ${escapeHtml(nonZero.map(fmtDec).join(', '))}`
: `Ve 4týdenním okně není žádná nenulová potřeba.`);

// --- rozpis vypoctu Q3 (75. percentil) ---
if (q3w == null) {
li.push('Kvartil Q3 nelze spočítat (bez nenulových týdnů).');
} else if (nonZero.length === 1) {
li.push(`Zůstala jediná hodnota, <b>Q3 = ${escapeHtml(fmtDec(nonZero[0]))}</b>`);
} else {
// pozice v serazene rade a linearni interpolace mezi sousedy
const n = nonZero.length;
const pos = 0.75 * (n - 1);
const lo = Math.floor(pos);
const hi = Math.ceil(pos);
const zbytek = pos - lo;

let vypocet;
if (lo === hi) {
vypocet = `pozice <b>0,75 × (${n} − 1) = ${escapeHtml(fmtDec(pos))}</b> padne přesně na ${lo + 1}. hodnotu → <b>${escapeHtml(fmtDec(nonZero[lo]))}</b>`;
} else {
vypocet = `pozice <b>0,75 × (${n} − 1) = ${escapeHtml(fmtDec(pos))}</b> leží mezi ${lo + 1}. a ${hi + 1}. hodnotou `
+ `(${escapeHtml(fmtDec(nonZero[lo]))} a ${escapeHtml(fmtDec(nonZero[hi]))})<br>`
+ `${escapeHtml(fmtDec(nonZero[lo]))} + ${escapeHtml(fmtDec(zbytek))} × (${escapeHtml(fmtDec(nonZero[hi]))} − ${escapeHtml(fmtDec(nonZero[lo]))}) = `
+ `<b>${escapeHtml(fmtDec(q3w))}</b>`;
}
li.push(`Kvartil <b>Q3</b> (75. percentil): ${vypocet} <span class="muted">(orientačně)</span>`);
}

li.push(vp && vp.q3 != null
? `Přepočet na 2denní hladinu (× 2 ÷ 7, zaokrouhleno nahoru) → <b>q3 = ${escapeHtml(fmt(vp.q3))}</b> <span class="muted">(hodnota z DB)</span>`
: `2denní hladina se nepočítá (viz důvod níže).`);

if (vp && vp.current_level != null && Number(vp.current_level) > 0 && vp.q3 != null) {
li.push(`Porovnání s aktuální hladinou <b>${escapeHtml(fmt(vp.current_level))}</b> a pásmem ±${Math.round(BAND * 100)} % → <b>${escapeHtml(vp.action_label)}</b>`);
} else {
li.push(`Rozhodnutí: <b>${escapeHtml(vp ? vp.action_label : '—')}</b>`);
}

return `<ol class="steps">${li.map((t) => `<li>${t}</li>`).join('')}</ol>`;
}

async function openDetail(material) {
drawer.hidden = false;
drawerTitle.textContent = material;
drawerBody.innerHTML = '<p class="note">Načítám detail…</p>';

try {
const data = await apiGet(`/material?material=${encodeURIComponent(material)}&run_at=${encodeURIComponent(currentRunAt)}`);
const vp = data.vypocet;
const potreby = data.potreby || [];

const kind = vp ? actionKind(vp.action_label) : 'flat';

const nums = `
<div class="detail-nums">
<div class="detail-num"><div class="n-label">Aktuální hladina</div><div class="n-value">${vp ? fmt(vp.current_level) : '—'}</div></div>
<div class="detail-num"><div class="n-label">Nová hladina</div><div class="n-value">${vp && vp.new_level != null ? fmt(vp.new_level) : '<span class="muted">nenastaveno</span>'}</div></div>
<div class="detail-num"><div class="n-label">Změna</div><div class="n-value">${vp ? fmtPct(vp.pct_change) : '—'}</div></div>
</div>`;

const verdict = vp ? `
<div class="detail-verdict">
<span class="badge badge-${kind}">${escapeHtml(vp.action_label)}</span>
<span class="v-text">${escapeHtml(verdictText(vp))}</span>
</div>` : '';

const chart = `
<div class="detail-block-title">Týdenní potřeby (forecast)</div>
<div class="chart-card wh-demand" data-metric="Týdenní požadavek">${demandChartSvg(potreby, { factor: 1 })}<div class="wh-tip" hidden></div></div>

<div class="detail-block-title" style="margin-top:18px">Přepočet na 2denní hladinu (× 2 ÷ 7)</div>
<div class="chart-card wh-demand" data-metric="2denní ekvivalent">${demandChartSvg(potreby, { factor: 2 / 7, qLine: vp && vp.q3 != null ? Number(vp.q3) : null, qSolid: true })}<div class="wh-tip" hidden></div></div>
<div class="chart-legend">
<span class="lg"><span class="lg-swatch" style="background:var(--brand)"></span>4týdenní okno</span>
<span class="lg"><span class="lg-swatch" style="background:#c3d0c8"></span>ostatní týdny</span>
<span class="lg"><span class="lg-line lg-line-solid"></span>Q3 → 2denní hladina (z DB)</span>
</div>`;

const steps = `
<div class="detail-block-title" style="margin-top:20px">Jak hladina vznikla</div>
${stepsHtml(vp, potreby)}`;

const meta = vp ? `<p class="note">Běh výpočtu: ${escapeHtml(fmtDateTime(vp.run_at))}${vp.approved_at ? ` · schváleno ${escapeHtml(fmtDateTime(vp.approved_at))}${vp.approved_by ? ` (${escapeHtml(vp.approved_by)})` : ''}` : ''}${vp.exported_at ? ` · exportováno ${escapeHtml(fmtDateTime(vp.exported_at))}` : ''}</p>` : '';

drawerBody.innerHTML = nums + verdict + chart + steps + meta;
wireChartTooltip();
} catch (err) {
drawerBody.innerHTML = `<p class="note" style="color:var(--down)">Chyba: ${escapeHtml(err.message)}</p>`;
}
}

function verdictText(vp) {
const kind = actionKind(vp.action_label);
if (kind === 'up') return 'Nová hladina je větší o více než 20% – navyšujeme.';
if (kind === 'down') return 'Nová hladina je menší o více než 20% – snižujeme.';
if (kind === 'dead') return 'Ve výsledu 18. týdnů není žádná potřeba – hladina se sráží na 0.';
if (kind === 'new') return 'Materiál bez dosavadní hladiny – nasazuje se spočtená hodnota.';
return 'Rozdíl není větší než ±20 % – hladina zůstává beze změny.';
}

// Napoji hover tooltip na grafy potreb (tydenni i 2denni). Pri najeti na
// sloupec ukaze tyden a hodnotu podle metriky daneho grafu (data-metric).
function wireChartTooltip() {
drawerBody.querySelectorAll('.wh-demand').forEach((card) => {
const tip = card.querySelector('.wh-tip');
if (!tip) return;
const metric = card.getAttribute('data-metric') || 'Hodnota';

card.querySelectorAll('.wh-bar-hit').forEach((hit) => {
hit.addEventListener('mouseenter', () => {
const week = hit.getAttribute('data-week') || '';
const val = Number(hit.getAttribute('data-val'));
const inWin = hit.getAttribute('data-inwin') === '1';
tip.innerHTML =
`<span class="wh-tip-week">${escapeHtml(week)}</span>` +
`<span class="wh-tip-row">${escapeHtml(metric)}: <b>${fmt(val)}</b> ks</span>` +
(inWin ? '<span class="wh-tip-win">ve výpočetním okně</span>' : '');
tip.hidden = false;
});
hit.addEventListener('mousemove', (e) => {
const box = card.getBoundingClientRect();
tip.style.left = (e.clientX - box.left) + 'px';
tip.style.top = (e.clientY - box.top - 12) + 'px';
});
hit.addEventListener('mouseleave', () => { tip.hidden = true; });
});
});
}

function closeDrawer() { drawer.hidden = true; drawerBody.innerHTML = ''; }

/* ==================== VYJIMKY z automatickeho vypoctu ====================
Zaskrtnuty material se nepocita automaticky - hladina mu zustava na
aktualni hodnote a takto se i exportuje. Zapis jde do tabulky
skladyHladiny.vyjimky; projevi se az pri pristim behu vypoctu. */

async function ulozVyjimku(material, zapnuto, box) {
if (box) box.disabled = true;
try {
const res = await fetch(`${API_BASE}/vyjimky`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ material, zapnuto }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(body.error || `Server odpověděl chybou ${res.status}.`);

// udrzime lokalni stav, at filtr i export pracuji s aktualnimi daty
const row = allRows.find((r) => r.material === material);
if (row) row.is_vyjimka = zapnuto ? 1 : 0;
setStatus(zapnuto
? `${material}: vyloučeno z automatické kalkulace (projeví se příštím výpočtem).`
: `${material}: výjimka zrušena.`, 'ok');
} catch (err) {
if (box) box.checked = !zapnuto; // vratime checkbox zpet
setStatus(`Výjimku se nepodařilo uložit: ${err.message}`, 'error');
} finally {
if (box) box.disabled = false;
}
}

/* ==================== EXCEL-STYLE FILTRY ====================
Kazdy sloupec ma v hlavicce trychtyr. Panel nabizi razeni, hledani
a zaskrtavaci seznam hodnot - stejne jako v Excelu. Filtruje se podle
hodnoty, kterou uzivatel VIDI v bunce (ne podle syrove hodnoty z DB). */

const FILTER_COLS = ['material', 'current_level', 'new_level', 'pct_change',
'action_label', 'storage_type', 'is_vyjimka'];

// Text bunky pro dany sloupec - musi sedet s tim, co vykresluje renderTable.
function cellText(r, key) {
if (key === 'pct_change') return fmtPct(r.pct_change);
if (key === 'is_vyjimka') return r.is_vyjimka ? 'Ano' : 'Ne';
if (key === 'storage_type') return String(r.storage_type || '—');
if (key === 'current_level' || key === 'new_level') {
return r[key] == null ? '—' : fmt(r[key]);
}
return String(r[key] == null ? '' : r[key]);
}

// Radky po aplikaci vsech filtru KROME jednoho (Excel takto plni nabidku).
function rowsExcept(skipKey) {
return allRows.filter((r) => FILTER_COLS.every((k) => {
if (k === skipKey) return true;
const sel = colFilters[k];
return !sel || sel.has(cellText(r, k));
}));
}

function openXlFilter(key, th) {
xlKey = key;
const panel = document.getElementById('xlFilter');
const list = document.getElementById('xlList');
const search = document.getElementById('xlSearch');

const hodnoty = Array.from(new Set(rowsExcept(key).map((r) => cellText(r, key))))
.sort((a, b) => a.localeCompare(b, 'cs', { numeric: true }));
const sel = colFilters[key];

list.innerHTML = hodnoty.map((v) => `
<label class="xl-item"><input type="checkbox" data-v="${escapeHtml(v)}"${!sel || sel.has(v) ? ' checked' : ''}>
<span>${escapeHtml(v === '' ? '(prázdné)' : v)}</span></label>`).join('');
search.value = '';
syncXlAll();

// umisteni pod hlavicku sloupce
const box = th.getBoundingClientRect();
panel.hidden = false;
const w = panel.offsetWidth || 240;
panel.style.left = Math.max(8, Math.min(box.left, window.innerWidth - w - 8)) + 'px';
panel.style.top = (box.bottom + window.scrollY + 2) + 'px';
}

function closeXlFilter() {
const panel = document.getElementById('xlFilter');
if (panel) panel.hidden = true;
xlKey = null;
}

function syncXlAll() {
const all = document.getElementById('xlAll');
const boxes = [...document.querySelectorAll('#xlList .xl-item input')];
const zaskrtnuto = boxes.filter((b) => b.checked).length;
all.checked = boxes.length > 0 && zaskrtnuto === boxes.length;
all.indeterminate = zaskrtnuto > 0 && zaskrtnuto < boxes.length;
}

function applyXlFilter() {
if (!xlKey) return;
const boxes = [...document.querySelectorAll('#xlList .xl-item input')];
const vybrane = boxes.filter((b) => b.checked).map((b) => b.getAttribute('data-v'));

if (vybrane.length === boxes.length) delete colFilters[xlKey]; // vse = bez filtru
else colFilters[xlKey] = new Set(vybrane);

if (xlKey === 'action_label') {
const f = colFilters.action_label;
actionFilter = (f && f.size === 1) ? Array.from(f)[0] : null;
if (lastSummary.length) renderSummary(lastSummary);
}
page = 1;
closeXlFilter();
renderTable();
}

// Trychtyre do hlavicky + oznaceni aktivnich filtru.
function initHeaderFilters() {
document.querySelectorAll('thead th[data-key]').forEach((th) => {
if (th.querySelector('.xl-btn')) return;

// Text hlavicky zabalime do spanu, aby sel poskladat vedle tlacitka.
const popisek = document.createElement('span');
popisek.className = 'th-label';
Array.from(th.childNodes).forEach((n) => {
if (n.nodeType === 3) { popisek.appendChild(n); } // textovy uzel
});
th.insertBefore(popisek, th.firstChild);

const btn = document.createElement('button');
btn.type = 'button';
btn.className = 'xl-btn';
btn.title = 'Filtr a řazení';
btn.setAttribute('aria-label', 'Filtr sloupce');
btn.innerHTML =
'<svg viewBox="0 0 16 16" aria-hidden="true">' +
'<path d="M2 3.2h12L9.4 8.3v4.3l-2.8 1.4V8.3z" fill="currentColor"/></svg>';
btn.addEventListener('click', (e) => {
e.stopPropagation();
const key = th.getAttribute('data-key');
if (xlKey === key) { closeXlFilter(); return; }
openXlFilter(key, th);
});
th.appendChild(btn);
});
}

function markActiveFilters() {
document.querySelectorAll('thead th[data-key]').forEach((th) => {
th.classList.toggle('has-filter', !!colFilters[th.getAttribute('data-key')]);
});
}

/* ==================== HROMADNA vyjimka ====================
Checkbox v hlavicce sloupce Vyjimka aplikuje zmenu na CELY aktualne
filtrovany vyber (ne jen na zobrazenou stranku). Pred zapisem se ptame
na potvrzeni s konkretnim poctem. */

async function hromadnaVyjimka(zapnuto, master) {
const rows = currentRows();
if (!rows.length) { setStatus('Filtru neodpovídá žádný materiál.', 'empty'); syncMaster(); return; }

// menit chceme jen ty, u kterych se stav realne lisi
const cile = rows.filter((r) => !!r.is_vyjimka !== zapnuto).map((r) => r.material);
if (!cile.length) { setStatus('Všechny materiály ve filtru už mají požadovaný stav.', 'ok'); syncMaster(); return; }

const akce = zapnuto ? 'nastavit výjimku' : 'zrušit výjimku';
if (!window.confirm(`Opravdu ${akce} pro ${nf0.format(cile.length)} materiálů?\n\nPlatí pro celý filtrovaný výběr, ne jen pro tuto stránku.`)) {
syncMaster();
return;
}

if (master) master.disabled = true;
setStatus(`Ukládám ${nf0.format(cile.length)} změn…`, 'loading');
try {
const res = await fetch(`${API_BASE}/vyjimky/hromadne`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ materials: cile, zapnuto, poznamka: 'Hromadně z portálu' }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(body.error || `Server odpověděl chybou ${res.status}.`);

const set = new Set(cile);
allRows.forEach((r) => { if (set.has(r.material)) r.is_vyjimka = zapnuto ? 1 : 0; });
renderTable();
setStatus(`${zapnuto ? 'Nastaveno' : 'Zrušeno'} ${nf0.format(cile.length)} výjimek (projeví se příštím výpočtem).`, 'ok');
} catch (err) {
setStatus(`Hromadnou změnu se nepodařilo uložit: ${err.message}`, 'error');
renderTable();
} finally {
if (master) master.disabled = false;
}
}

// Stav master checkboxu podle filtrovaneho vyberu (vc. neurciteho stavu).
function syncMaster() {
const master = document.getElementById('excAll');
if (!master) return;
const rows = currentRows();
const s = rows.filter((r) => r.is_vyjimka).length;
master.checked = rows.length > 0 && s === rows.length;
master.indeterminate = s > 0 && s < rows.length;
}

/* ==================== inicializace filtru v hlavicce ==================== */

function populateTypeFilter() {
initHeaderFilters();
}


/* ==================== ZDROJOVA DATA + PREPOCET ====================
Vypocet potrebuje vsechny tri reporty pohromade. Panel proto ukazuje,
kdy naposledy kazdy z nich dorazil - at je videt, ze ceho vypocet je. */

const ZDROJ_POPIS = {
potreby: 'Týdenní potřeby',
aktualni_hladiny: 'Aktuální hladiny',
nove_hladiny: 'Nové materiály',
};

// Stari v hodinach -> barevny stav (dnes / vcera / starsi).
function stariTrida(iso) {
if (!iso) return 'zdroj-chybi';
const hodin = (Date.now() - new Date(iso).getTime()) / 36e5;
if (hodin < 24) return 'zdroj-cerstvy';
if (hodin < 48) return 'zdroj-vcerejsi';
return 'zdroj-stary';
}

function renderZdroje(zdroje) {
const box = document.getElementById('zdrojeBox');
const list = document.getElementById('zdrojeList');
if (!box || !list) return;

if (!zdroje || !zdroje.length) { box.hidden = true; return; }

list.innerHTML = zdroje.map((z) => {
const nazev = ZDROJ_POPIS[z.zdroj] || z.zdroj;
const cls = stariTrida(z.loaded_at);
const kdy = z.loaded_at ? fmtDateTime(z.loaded_at) : 'neimportováno';
return `<div class="zdroj ${cls}">
<span class="zdroj-dot"></span>
<span class="zdroj-nazev">${escapeHtml(nazev)}</span>
<span class="zdroj-kdy">${escapeHtml(kdy)}</span>
<span class="zdroj-pocet">${nf0.format(Number(z.pocet || 0))} řádků</span>
</div>`;
}).join('');

// Upozorneni, kdyz zdroje nejsou ze stejneho dne - vypocet by michal
// cerstve potreby se starymi hladinami.
const dny = new Set(zdroje.filter((z) => z.loaded_at)
.map((z) => new Date(z.loaded_at).toDateString()));
const chybi = zdroje.some((z) => !z.loaded_at);
let varovani = '';
if (chybi) varovani = 'Některý ze zdrojů zatím nebyl naimportován.';
else if (dny.size > 1) varovani = 'Zdroje nejsou ze stejného dne — výpočet by kombinoval různě stará data.';
list.insertAdjacentHTML('beforeend', varovani
? `<p class="zdroje-warn">${escapeHtml(varovani)}</p>` : '');

box.hidden = false;
}

async function nactiZdroje() {
try {
renderZdroje(await apiGet('/zdroje'));
} catch (err) {
// stari dat je jen doplnkova informace - chyba nesmi shodit stranku
console.warn('Stáří zdrojových dat se nepodařilo načíst:', err.message);
}
}

async function spustPrepocet(btn) {
if (!window.confirm(
'Spustit přepočet hladin?\n\n' +
'Přepíše se stávající návrh pro všechny materiály. ' +
'Výpočet může trvat několik minut.')) return;

const puvodni = btn.textContent;
btn.disabled = true;
btn.textContent = 'Počítám…';
setStatus('Probíhá přepočet hladin, může to trvat několik minut…', 'loading');

try {
const res = await fetch(`${API_BASE}/prepocet`, { method: 'POST' });
const body = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(body.error || `Server odpověděl chybou ${res.status}.`);

renderZdroje(body.zdroje);
setStatus(`Přepočet hotov: ${nf0.format(Number(body.pocet_celkem || 0))} materiálů (${fmtDateTime(body.run_at)}). Načítám výsledek…`, 'ok');

// znovu nacist seznam behu, at se vybere ten novy
await init();
} catch (err) {
setStatus(`Přepočet se nepodařilo dokončit: ${err.message}`, 'error');
} finally {
btn.disabled = false;
btn.textContent = puvodni;
}
}

/* ==================== NAPOVEDA k vypoctu ==================== */

function helpHtml() {
const band = Math.round(BAND * 100);
return `
<p class="modal-lead">Cílem je držet na skladě zhruba dvoudenní spotřebu podle toho,
co se má v nejbližších týdnech skutečně odebírat.</p>
<ol class="steps">
<li>Vezmeme <b>${WINDOW_LEN} týdny</b> forecastu (indexy ${WINDOW_START}–${WINDOW_START + WINDOW_LEN - 1}).
Aktuální týden se nepočítá, ten už běží.</li>
<li>Vynecháme týdny s nulovou potřebou, aby prázdné týdny neshodily výsledek.</li>
<li>Ze zbylých hodnot vezmeme <b>kvartil Q3</b> (75. percentil) — hodnotu, pod kterou
leží tři čtvrtiny týdnů. Je odolnější než průměr, ale nepodcení špičky.</li>
<li>Týdenní číslo přepočteme na <b>2 dny</b>: <b>× 2 ÷ 7</b>, zaokrouhleno nahoru.</li>
<li>Porovnáme s aktuální hladinou. Když je rozdíl do <b>±${band} %</b>, necháváme
beze změny — nemá smysl hýbat hladinou kvůli drobnosti.</li>
</ol>
<div class="help-example">
<div class="help-example-title">Příklad</div>
<p>Týdenní potřeby <b>42,549</b> · <b>17,265</b> · <b>8,178</b> · <b>28,161</b>.
Seřazeno: 8,178 · 17,265 · 28,161 · 42,549.</p>
<p>Q3 (75 %) = <b>31,758</b>. Přepočet na 2 dny: 31,758 × 2 ÷ 7 = <b>9,073</b> → nová hladina <b>10</b>.</p>
<p>Kdyby aktuální hladina byla 9, rozdíl je uvnitř ±${band} % → <i>Beze změny</i>.</p>
</div>
<p class="note">Autoritativní hodnoty (Q3, nová hladina, důvod) počítá databázová procedura.
Grafy v detailu jen ukazují, jak k číslu došlo.</p>`;
}

function openModal(id) { const m = document.getElementById(id); if (m) m.hidden = false; }
function closeModal(id) { const m = document.getElementById(id); if (m) m.hidden = true; }

/* ==================== EXPORT do SAP predlohy ====================
A = cislo ciloveho typu skladu (format Text - "060" musi zustat)
B = materialove cislo (VELKA PISMENA)
C = prumerna tydenni potreba
D = vzdy 0
Generujeme SpreadsheetML 2003 (.xls): otevre se v Excelu a na rozdil
od CSV umi vynutit textovy format, takze vedouci nula nezmizi. */

// Aktivni typ skladu = ve filtru sloupce je vybrana prave jedna hodnota.
function aktivniTyp() {
const f = colFilters.storage_type;
return (f && f.size === 1) ? Array.from(f)[0] : '';
}

function exportRows(scope) {
// "current" = presne to, co ma uzivatel odfiltrovane v tabulce
if (scope === 'current') return currentRows();
// "all" = vsechny typy skladu, ostatni filtry ale respektujeme
return allRows.filter((r) => FILTER_COLS.every((k) => {
if (k === 'storage_type') return true;
const sel = colFilters[k];
return !sel || sel.has(cellText(r, k));
}));
}

function xmlEsc(v) {
return String(v == null ? '' : v)
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildExportXls(rows) {
const body = rows.map((r) => {
const typ = String(r.storage_type || '').trim();
const mat = String(r.material || '').trim().toUpperCase();
// Vyjimka = material se nepocita automaticky, exportuje se
// s aktualni hladinou; ostatni s prumernou tydenni potrebou.
const avg = r.is_vyjimka
? Math.ceil(Number(r.current_level) || 0)
: (r.avg_weekly == null ? 0 : Math.ceil(Number(r.avg_weekly)));
return '<Row>' +
`<Cell ss:StyleID="sText"><Data ss:Type="String">${xmlEsc(typ)}</Data></Cell>` +
`<Cell><Data ss:Type="String">${xmlEsc(mat)}</Data></Cell>` +
`<Cell><Data ss:Type="Number">${avg}</Data></Cell>` +
'<Cell><Data ss:Type="Number">0</Data></Cell>' +
'</Row>';
}).join('');
return '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
'<Styles><Style ss:ID="sText"><NumberFormat ss:Format="@"/></Style></Styles>' +
'<Worksheet ss:Name="Export"><Table>' + body + '</Table></Worksheet></Workbook>';
}

function runExport(scope) {
const rows = exportRows(scope);
if (!rows.length) { setStatus('Export: žádné řádky neodpovídají výběru.', 'empty'); return; }
const blob = new Blob(['\ufeff' + buildExportXls(rows)], { type: 'application/vnd.ms-excel;charset=utf-8' });
const stamp = (currentRunAt || '').replace(/[^0-9]/g, '').slice(0, 8);
const t = aktivniTyp();
const suffix = scope === 'current' && t ? '_typ' + t : '_vse';
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = `hladiny_export_${stamp}${suffix}.xls`;
document.body.appendChild(a); a.click(); document.body.removeChild(a);
setTimeout(() => URL.revokeObjectURL(a.href), 1000);
closeModal('exportModal');
setStatus(`Vyexportováno ${nf0.format(rows.length)} řádků.`, 'ok');
}

/* ============================ udalosti ============================ */

runSelect.addEventListener('change', () => loadRun(runSelect.value));
refreshBtn.addEventListener('click', () => loadRun(currentRunAt || runSelect.value));

document.querySelectorAll('th.sortable').forEach((th) => {
th.addEventListener('click', () => {
const key = th.getAttribute('data-key');
if (sortKey === key) sortDir = -sortDir;
else { sortKey = key; sortDir = 1; }
page = 1;
renderTable();
});
});

prevPage.addEventListener('click', () => { if (page > 1) { page--; renderTable(); } });
nextPage.addEventListener('click', () => { page++; renderTable(); });

drawerClose.addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });

const excAll = document.getElementById('excAll');
if (excAll) excAll.addEventListener('change', () => hromadnaVyjimka(excAll.checked, excAll));
if (excAll) excAll.addEventListener('click', (e) => e.stopPropagation());

// --- panel excelovskeho filtru ---
const xlSearch = document.getElementById('xlSearch');
if (xlSearch) xlSearch.addEventListener('input', () => {
const t = xlSearch.value.trim().toLowerCase();
document.querySelectorAll('#xlList .xl-item').forEach((it) => {
it.hidden = t && !it.textContent.toLowerCase().includes(t);
});
});

const xlAll = document.getElementById('xlAll');
if (xlAll) xlAll.addEventListener('change', () => {
document.querySelectorAll('#xlList .xl-item').forEach((it) => {
if (!it.hidden) it.querySelector('input').checked = xlAll.checked;
});
syncXlAll();
});

const xlList = document.getElementById('xlList');
if (xlList) xlList.addEventListener('change', syncXlAll);

const xlOk = document.getElementById('xlOk');
if (xlOk) xlOk.addEventListener('click', applyXlFilter);

const xlClear = document.getElementById('xlClear');
if (xlClear) xlClear.addEventListener('click', () => {
if (xlKey) {
delete colFilters[xlKey];
if (xlKey === 'action_label') { actionFilter = null; if (lastSummary.length) renderSummary(lastSummary); }
}
page = 1; closeXlFilter(); renderTable();
});

document.querySelectorAll('.xl-sort-btn').forEach((b) => {
b.addEventListener('click', () => {
if (!xlKey) return;
sortKey = xlKey; sortDir = b.getAttribute('data-dir') === 'asc' ? 1 : -1;
page = 1; closeXlFilter(); renderTable();
});
});

// klik mimo panel ho zavre
document.addEventListener('click', (e) => {
const panel = document.getElementById('xlFilter');
if (!panel || panel.hidden) return;
if (!panel.contains(e.target) && !e.target.closest('.xl-btn')) closeXlFilter();
});

const pageSel = document.getElementById('pageSize');
if (pageSel) pageSel.addEventListener('change', () => {
PAGE_SIZE = pageSel.value === 'all' ? 'all' : Number(pageSel.value);
page = 1; renderTable();
});

const calcBtn = document.getElementById('calcBtn');
if (calcBtn) calcBtn.addEventListener('click', () => spustPrepocet(calcBtn));

const helpBtn = document.getElementById('helpBtn');
if (helpBtn) helpBtn.addEventListener('click', () => {
document.getElementById('helpBody').innerHTML = helpHtml();
openModal('helpModal');
});

const exportBtn = document.getElementById('exportBtn');
if (exportBtn) exportBtn.addEventListener('click', () => {
const cur = document.getElementById('expCurrentInfo');
const all = document.getElementById('expAllInfo');
const curRadio = document.querySelector('input[name="expScope"][value="current"]');
const t = aktivniTyp();
if (t || Object.keys(colFilters).length) {
cur.textContent = `${t ? 'typ ' + t + ' · ' : ''}${nf0.format(exportRows('current').length)} řádků`;
curRadio.disabled = false; curRadio.checked = true;
} else {
cur.textContent = 'v tabulce není nastavený žádný filtr';
curRadio.disabled = true;
document.querySelector('input[name="expScope"][value="all"]').checked = true;
}
all.textContent = `${nf0.format(exportRows('all').length)} řádků`;
openModal('exportModal');
});

const exportRunBtn = document.getElementById('exportRun');
if (exportRunBtn) exportRunBtn.addEventListener('click', () => {
const sel = document.querySelector('input[name="expScope"]:checked');
runExport(sel ? sel.value : 'all');
});

document.querySelectorAll('[data-close]').forEach((el) => {
el.addEventListener('click', () => closeModal(el.getAttribute('data-close') === 'help' ? 'helpModal' : 'exportModal'));
});
document.addEventListener('keydown', (e) => {
if (e.key === 'Escape') { closeModal('helpModal'); closeModal('exportModal'); }
});

init();
})();
