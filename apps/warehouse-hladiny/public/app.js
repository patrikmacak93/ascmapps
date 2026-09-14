/* ===========================================================================
app.js - logika stranky Skladove hladiny

Tok:
1. Nacte seznam behu (/api/runs) a naplni vyber. Vybere nejnovejsi.
2. Pro vybrany beh nacte souhrn (/api/summary) -> KPI karty + rozdeleni,
a radky (/api/vypocet) -> tabulka.
3. Klik na radek nacte detail (/api/material) a otevre "drawer" s
VIZUALIZACI VYPOCTU: graf tydennich potreb, zvyraznene 4tydenni okno,
kvartil Q3, prepocet na 2denni hladinu a pasmo ±20 %.

API klic tady zamerne NENI - frontend mluvi jen s vlastnim app-backendem
(server/routes/index.js), ten teprve prida klic a zavola sql-connector.
Vsechno je READ-ONLY: appka nic nezapisuje, jen zobrazuje navrh.
=========================================================================== */

'use strict';

(function () {
const CFG = window.APP_CONFIG || {};
const API_BASE = CFG.API_BASE || './api';
const WINDOW_START = Number.isFinite(CFG.WINDOW_START) ? CFG.WINDOW_START : 1;
const WINDOW_LEN = Number.isFinite(CFG.WINDOW_LEN) ? CFG.WINDOW_LEN : 4;
const BAND = Number.isFinite(CFG.BAND) ? CFG.BAND : 0.2;
const PAGE_SIZE = 50;

// --- prvky DOM ---
const runSelect = document.getElementById('runSelect');
const runMeta = document.getElementById('runMeta');
const refreshBtn = document.getElementById('refreshBtn');
const statusEl = document.getElementById('status');

const summarySection = document.getElementById('summarySection');
const kpiRow = document.getElementById('kpiRow');
const distBars = document.getElementById('distBars');

const tableSection = document.getElementById('tableSection');
const searchInput = document.getElementById('searchInput');
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
let searchTerm = '';
let actionFilter = null;
let page = 1;

/* ============================ pomocnici ============================ */

function escapeHtml(v) {
return String(v == null ? '' : v)
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const nf0 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const nf3 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 3 });

function fmt(v, dec) {
if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
return (dec ? nf3 : nf0).format(Number(v));
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
// reset filtru/strankovani pri zmene behu
actionFilter = null;
searchTerm = '';
searchInput.value = '';
page = 1;
renderTable();

summarySection.hidden = false;
tableSection.hidden = false;

const zmeny = allRows.filter(
(r) => r.new_level != null && (r.current_level == null || Number(r.new_level) !== Number(r.current_level))
).length;
setStatus(`Běh ${fmtDateTime(currentRunAt)} — ${allRows.length} materiálů, z toho ${zmeny} navržených změn.`, 'ok');
runMeta.textContent = '';
} catch (err) {
setStatus(`Chyba: ${err.message}`, 'error');
}
}

/* ============================ souhrn ============================ */

function renderSummary(summary) {
const byLabel = summary || [];
const total = byLabel.reduce((s, x) => s + Number(x.pocet || 0), 0);

// KPI karty: celkem + agregace po kategoriich (up/down/flat/dead/new)
const kinds = { up: 0, down: 0, flat: 0, dead: 0, new: 0 };
byLabel.forEach((x) => { kinds[actionKind(x.action_label)] += Number(x.pocet || 0); });

const kpis = [
{ label: 'Materiálů', value: total, color: 'var(--brand)' },
{ label: 'Navýšeno', value: kinds.up, color: KIND_COLOR.up },
{ label: 'Poníženo', value: kinds.down, color: KIND_COLOR.down },
{ label: 'Beze změny', value: kinds.flat, color: KIND_COLOR.flat },
{ label: 'Mrtvé', value: kinds.dead, color: KIND_COLOR.dead },
{ label: 'Nové', value: kinds.new, color: KIND_COLOR.new },
];
kpiRow.innerHTML = kpis.map((k) =>
`<div class="kpi" style="--kpi-color:${k.color}">
<div class="kpi-value">${nf0.format(k.value)}</div>
<div class="kpi-label">${escapeHtml(k.label)}</div>
</div>`
).join('');

// Rozdeleni po presnych action_label (klikaci -> filtr tabulky)
const maxCount = Math.max(1, ...byLabel.map((x) => Number(x.pocet || 0)));
distBars.innerHTML = byLabel.map((x) => {
const kind = actionKind(x.action_label);
const pct = (Number(x.pocet || 0) / maxCount) * 100;
const active = actionFilter === x.action_label ? ' active' : '';
return `<div class="dist-row${active}" data-label="${escapeHtml(x.action_label)}" role="button" tabindex="0">
<span class="dist-name"><span class="dist-dot" style="background:${KIND_COLOR[kind]}"></span>${escapeHtml(x.action_label)}</span>
<span class="dist-track"><span class="dist-fill" style="width:${pct}%;background:${KIND_COLOR[kind]}"></span></span>
<span class="dist-count">${nf0.format(Number(x.pocet || 0))}</span>
</div>`;
}).join('');

distBars.querySelectorAll('.dist-row').forEach((row) => {
const label = row.getAttribute('data-label');
const toggle = () => {
actionFilter = actionFilter === label ? null : label;
page = 1;
renderSummary(summary); // prekresli aktivni stav
renderTable();
};
row.addEventListener('click', toggle);
row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
});
}

/* ============================ tabulka ============================ */

function currentRows() {
let rows = allRows;
if (actionFilter) rows = rows.filter((r) => r.action_label === actionFilter);
if (searchTerm) {
const t = searchTerm.toLowerCase();
rows = rows.filter((r) => String(r.material || '').toLowerCase().includes(t));
}
const numeric = new Set(['current_level', 'q3', 'new_level', 'pct_change']);
rows = rows.slice().sort((a, b) => {
let va = a[sortKey], vb = b[sortKey];
if (numeric.has(sortKey)) {
va = va == null ? -Infinity : Number(va);
vb = vb == null ? -Infinity : Number(vb);
return (va - vb) * sortDir;
}
return String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'cs') * sortDir;
});
return rows;
}

function renderTable() {
const rows = currentRows();
const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
if (page > pages) page = pages;
const start = (page - 1) * PAGE_SIZE;
const pageRows = rows.slice(start, start + PAGE_SIZE);

if (!rows.length) {
whBody.innerHTML = `<tr><td colspan="7" class="wh-message">Žádné řádky neodpovídají filtru.</td></tr>`;
} else {
whBody.innerHTML = pageRows.map((r) => {
const kind = actionKind(r.action_label);
const pctCls = r.pct_change > 0 ? 'pct-up' : r.pct_change < 0 ? 'pct-down' : 'muted';
const stav = r.exported_at
? '<span class="state-chip ok">Exportováno</span>'
: r.approved_at
? '<span class="state-chip ok">Schváleno</span>'
: '<span class="state-chip">Návrh</span>';
return `<tr data-material="${escapeHtml(r.material)}">
<td class="mat-cell">${escapeHtml(r.material)}</td>
<td class="num">${fmt(r.current_level)}</td>
<td class="num">${fmt(r.q3)}</td>
<td class="num">${r.new_level == null ? '<span class="muted">—</span>' : fmt(r.new_level)}</td>
<td class="num ${pctCls}">${fmtPct(r.pct_change)}</td>
<td><span class="badge badge-${kind}">${escapeHtml(r.action_label)}</span></td>
<td>${stav}</td>
</tr>`;
}).join('');

whBody.querySelectorAll('tr[data-material]').forEach((tr) => {
tr.addEventListener('click', () => openDetail(tr.getAttribute('data-material')));
});
}

rowCountEl.textContent = `${nf0.format(rows.length)} ${rows.length === 1 ? 'řádek' : rows.length >= 2 && rows.length <= 4 ? 'řádky' : 'řádků'}`;
pageInfo.textContent = `Strana ${page} / ${pages}`;
prevPage.disabled = page <= 1;
nextPage.disabled = page >= pages;

if (actionFilter) {
activeFilterEl.hidden = false;
activeFilterEl.innerHTML = `Filtr: ${escapeHtml(actionFilter)} <button type="button" title="Zrušit filtr">×</button>`;
activeFilterEl.querySelector('button').addEventListener('click', () => {
actionFilter = null; page = 1;
document.querySelectorAll('.dist-row').forEach((d) => d.classList.remove('active'));
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
// slouzi POUZE k umisteni carky v grafu. Autoritativni vysledek je q3 z DB.
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

// SVG sloupcovy graf tydennich potreb se zvyraznenym oknem + carka Q3.
function demandChartSvg(potreby, q3weekly) {
const W = 640, H = 240, padL = 28, padR = 12, padT = 16, padB = 40;
const plotW = W - padL - padR, plotH = H - padT - padB;
const baseY = padT + plotH;

const rows = potreby.slice().sort((a, b) => a.period_index - b.period_index);
if (!rows.length) return '<p class="note">Týdenní potřeby pro tento materiál nejsou v aktuálním importu.</p>';

const maxVal = Math.max(1, ...rows.map((r) => Number(r.requirement_qty) || 0), q3weekly || 0);
const n = rows.length;
const slot = plotW / n;
const bw = Math.min(26, slot * 0.62);

const winEnd = WINDOW_START + WINDOW_LEN - 1;
let bars = '';
let labels = '';
let hits = '';
rows.forEach((r, i) => {
const val = Number(r.requirement_qty) || 0;
const x = padL + slot * i + (slot - bw) / 2;
const h = (val / maxVal) * plotH;
const y = baseY - h;
const inWin = r.period_index >= WINDOW_START && r.period_index <= winEnd;
const color = val <= 0 ? '#e6ebe8' : inWin ? 'var(--brand)' : '#c3d0c8';
bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, val > 0 ? 2 : 0).toFixed(1)}" rx="2" fill="${color}"></rect>`;
// popisek tydne (zkraceny na cislo tydne z "cw 37/2026")
const short = String(r.period_label || r.period_index).replace(/^cw\s*/i, '').split('/')[0];
const cx = padL + slot * i + slot / 2;
labels += `<text x="${cx.toFixed(1)}" y="${(baseY + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${inWin ? 'var(--brand-dark)' : '#96a19a'}">${escapeHtml(short)}</text>`;
// neviditelna "hit" zona pres cely tydenni sloupec - kvuli tenkym sloupcum
// se snadno trefi hover; nese data pro tooltip (tyden + hodnota).
hits += `<rect class="wh-bar-hit" data-week="${escapeHtml(String(r.period_label || ('týden ' + r.period_index)))}" data-qty="${val}" data-inwin="${inWin ? '1' : '0'}" x="${(padL + slot * i).toFixed(1)}" y="${padT.toFixed(1)}" width="${slot.toFixed(1)}" height="${plotH.toFixed(1)}"></rect>`;
});

// vyznaceni okna (podklad)
let winRect = '';
const idxs = rows.map((r) => r.period_index);
const firstWin = rows.findIndex((r) => r.period_index >= WINDOW_START);
const lastWin = idxs.reduce((acc, v, i) => (v <= winEnd && v >= WINDOW_START ? i : acc), -1);
if (firstWin !== -1 && lastWin >= firstWin) {
const wx = padL + slot * firstWin + 2;
const ww = slot * (lastWin - firstWin + 1) - 4;
winRect = `<rect x="${wx.toFixed(1)}" y="${padT}" width="${ww.toFixed(1)}" height="${plotH}" fill="rgba(0,137,61,.07)" rx="6"></rect>`;
}

// carka Q3 (tydenni)
let q3line = '';
if (q3weekly != null && q3weekly > 0) {
const qy = baseY - (q3weekly / maxVal) * plotH;
q3line = `<line x1="${padL}" y1="${qy.toFixed(1)}" x2="${W - padR}" y2="${qy.toFixed(1)}" stroke="var(--down)" stroke-width="1.6" stroke-dasharray="5 4"></line>`;
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

// Mini pasmo ±BAND kolem aktualni hladiny + poloha q3 (proc padlo rozhodnuti).
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
const map = new Map(potreby.map((r) => [r.period_index, Number(r.requirement_qty) || 0]));
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
? `Vynecháme nulové týdny → zůstává <b>${nonZero.length}</b> hodnot: ${escapeHtml(nonZero.map((x) => fmt(x, true)).join(', '))}`
: `Ve 4týdenním okně není žádná nenulová potřeba.`);
li.push(q3w != null
? `Kvartil <b>Q3</b> (75 %) těchto hodnot ≈ <b>${escapeHtml(fmt(q3w, true))}</b> <span class="muted">(orientačně)</span>`
: `Kvartil Q3 nelze spočítat (bez nenulových týdnů).`);
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
const q3w = weeklyQ3(
potreby.filter((r) => r.period_index >= WINDOW_START && r.period_index <= WINDOW_START + WINDOW_LEN - 1)
.map((r) => Number(r.requirement_qty) || 0)
);

const kind = vp ? actionKind(vp.action_label) : 'flat';

const nums = `
<div class="detail-nums">
<div class="detail-num"><div class="n-label">Aktuální hladina</div><div class="n-value">${vp ? fmt(vp.current_level) : '—'}</div></div>
<div class="detail-num"><div class="n-label">Q3 → 2denní</div><div class="n-value">${vp ? fmt(vp.q3) : '—'}</div></div>
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
<div class="chart-card wh-demand">${demandChartSvg(potreby, q3w)}<div class="wh-tip" hidden></div></div>
<div class="chart-legend">
<span class="lg"><span class="lg-swatch" style="background:var(--brand)"></span>4týdenní okno</span>
<span class="lg"><span class="lg-swatch" style="background:#c3d0c8"></span>ostatní týdny</span>
<span class="lg"><span class="lg-line"></span>kvartil Q3 (týdenní)</span>
</div>`;

const band = vp && vp.current_level != null && Number(vp.current_level) > 0 && vp.q3 != null ? `
<div class="detail-block-title" style="margin-top:18px">Rozhodovací pásmo ±${Math.round(BAND * 100)} %</div>
<div class="chart-card">${bandBarSvg(vp.current_level, vp.q3)}</div>` : '';

const steps = `
<div class="detail-block-title" style="margin-top:20px">Jak hladina vznikla</div>
${stepsHtml(vp, potreby)}`;

const meta = vp ? `<p class="note">Běh výpočtu: ${escapeHtml(fmtDateTime(vp.run_at))}${vp.approved_at ? ` · schváleno ${escapeHtml(fmtDateTime(vp.approved_at))}${vp.approved_by ? ` (${escapeHtml(vp.approved_by)})` : ''}` : ''}${vp.exported_at ? ` · exportováno ${escapeHtml(fmtDateTime(vp.exported_at))}` : ''}</p>` : '';

const potrebyNote = potreby.length
? '<p class="note">Týdenní potřeby odrážejí poslední import (tabulka se přepisuje plným refreshem), ne stav v okamžiku běhu.</p>'
: '';

drawerBody.innerHTML = nums + verdict + chart + band + steps + meta + potrebyNote;
wireChartTooltip();
} catch (err) {
drawerBody.innerHTML = `<p class="note" style="color:var(--down)">Chyba: ${escapeHtml(err.message)}</p>`;
}
}

function verdictText(vp) {
const kind = actionKind(vp.action_label);
if (kind === 'up') return 'Nová hladina je nad pásmem tolerance – navyšujeme.';
if (kind === 'down') return 'Nová hladina je pod pásmem tolerance – snižujeme.';
if (kind === 'dead') return 'Bez potřeb na 18 týdnů – hladina se sráží na 0.';
if (kind === 'new') return 'Materiál bez dosavadní hladiny – nasazuje se spočtená hodnota.';
return 'Rozdíl je uvnitř pásma ±20 % – hladina zůstává beze změny.';
}

// Napoji hover tooltip na graf tydennich potreb. Pri najeti na sloupec
// (resp. na cely tydenni sloupec) ukaze tyden + hodnotu requirementu.
function wireChartTooltip() {
const card = drawerBody.querySelector('.wh-demand');
if (!card) return;
const tip = card.querySelector('.wh-tip');
if (!tip) return;

card.querySelectorAll('.wh-bar-hit').forEach((hit) => {
hit.addEventListener('mouseenter', () => {
const week = hit.getAttribute('data-week') || '';
const qty = Number(hit.getAttribute('data-qty'));
const inWin = hit.getAttribute('data-inwin') === '1';
tip.innerHTML =
`<span class="wh-tip-week">${escapeHtml(week)}</span>` +
`<span class="wh-tip-qty">${fmt(qty, true)} ks</span>` +
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
}

function closeDrawer() { drawer.hidden = true; drawerBody.innerHTML = ''; }

/* ============================ udalosti ============================ */

runSelect.addEventListener('change', () => loadRun(runSelect.value));
refreshBtn.addEventListener('click', () => loadRun(currentRunAt || runSelect.value));

searchInput.addEventListener('input', () => {
searchTerm = searchInput.value.trim();
page = 1;
renderTable();
});

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

init();
})();
