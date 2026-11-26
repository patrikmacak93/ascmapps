/* ===========================================================================
AGV Utilization - frontend
---------------------------------------------------------------------------
Data (vse pres backend ./api, ten se pta sql-connectoru):
/vehicles seznam AGV + rozsah dat
/shift-numbers cisla smen ze smenoveho planu (dbo.shiftPlan12h)
/status casy stavu v sekundach po dni / smene / AGV (dbo.agvStatus)
/orders/summary pocty ukolu po dni / smene / hodine / AGV (dbo.AGV_OrderStats)
/orders jednotlive ukoly pro monitor

Filtry (obdobi, smena, cislo smeny, AGV) se drzi v URL, takze odkaz jde poslat kolegovi.
Grafy jsou ciste SVG - zadna externi knihovna.
=========================================================================== */

(function () {
'use strict';

const CFG = window.APP_CONFIG || {};
const API = CFG.API_BASE || './api';
const SHIFTS = CFG.SHIFTS || { R: { label: 'Ranní', hours: '' }, N: { label: 'Noční', hours: '' } };
const SHIFT_COLORS = { R: '#e9a21b', N: '#2f4f86' };

// Stavy AGV v poradi pro kolac a legendu. key = nazev pole z /status.
const STATES = [
{ key: 'activeFull', label: 'Jízda s nákladem', pbi: 'Active Full', color: '#00893d', group: 'Práce' },
{ key: 'activeEmpty', label: 'Jízda bez nákladu', pbi: 'Active Empty', color: '#7ab800', group: 'Práce' },
{ key: 'idle', label: 'Nečinnost', pbi: 'Idle', color: '#a9b3ae', group: 'Připraven' },
{ key: 'charging', label: 'Nabíjení', pbi: 'Charging', color: '#3f7fc4', group: 'Připraven' },
{ key: 'pause', label: 'Pauza', pbi: 'Pause', color: '#cfd6d2', group: 'Připraven' },
{ key: 'obstruction', label: 'Překážka', pbi: 'Obstruction', color: '#e08a00', group: 'Ztráty' },
{ key: 'manual', label: 'Ruční režim', pbi: 'Manual', color: '#7b5ea7', group: 'Ztráty' },
{ key: 'failure', label: 'Porucha', pbi: 'Failure', color: '#c0392b', group: 'Ztráty' },
{ key: 'offline', label: 'Offline', pbi: 'Offline', color: '#3d4642', group: 'Ztráty' },
];
const UTIL_ACTIVE = CFG.UTIL_ACTIVE || ['activeFull', 'activeEmpty'];
const UTIL_EXCLUDE = CFG.UTIL_EXCLUDE || [];

const $ = (id) => document.getElementById(id);
const nf0 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const state = {
from: '', to: '', shift: '', vehicles: new Set(), crews: new Set(),
vehicleList: [], crewList: [], planFrom: '', planTo: '', dataMin: '', dataMax: '',
compareBy: 'vehicle',
status: [], summary: [], orders: [], ordersTotal: 0,
orderState: 'all', search: '', sortKey: 'created', sortDir: -1, page: 1,
reqId: 0,
};

/* ------------------------------------------------------------------ util */
function esc(s) {
return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toDate(iso) { return new Date(iso + 'T00:00:00Z'); }
function toIso(d) { return d.toISOString().slice(0, 10); }
function addDays(iso, n) { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); }
function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
function dateRange(from, to) {
const out = []; let d = from;
while (d <= to && out.length < 1000) { out.push(d); d = addDays(d, 1); }
return out;
}
function fmtDay(iso) { const [y, m, d] = iso.split('-'); return `${+d}. ${+m}. ${y}`; }
function fmtDayShort(iso) { const [, m, d] = iso.split('-'); return `${+d}. ${+m}.`; }
function fmtDateTime(s) {
if (!s) return '';
const [d, t] = s.split('T');
return `${fmtDayShort(d)} ${t.slice(0, 5)}`;
}
function fmtDur(sec) {
if (sec == null || !isFinite(sec)) return '';
sec = Math.round(sec);
if (sec < 60) return `${sec} s`;
const m = Math.floor(sec / 60), s = sec % 60;
if (m < 60) return `${m}:${String(s).padStart(2, '0')} min`;
return `${Math.floor(m / 60)} h ${m % 60} min`;
}
const hours = (sec) => sec / 3600;
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);
function fmtPct(v) { return v == null ? '–' : nf1.format(v) + ' %'; }

/* ------------------------------------------------------------- URL stav */
function readUrl() {
const p = new URLSearchParams(location.search);
const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
if (ok(p.get('from'))) state.from = p.get('from');
if (ok(p.get('to'))) state.to = p.get('to');
if (['R', 'N'].includes(p.get('shift'))) state.shift = p.get('shift');
const v = (p.get('agv') || '').split(',').map((x) => x.trim()).filter(Boolean);
state.vehicles = new Set(v);
const c = (p.get('crew') || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
state.crews = new Set(c);
}
function writeUrl() {
const p = new URLSearchParams();
p.set('from', state.from); p.set('to', state.to);
if (state.shift) p.set('shift', state.shift);
if (state.crews.size) p.set('crew', sortedCrews().join(','));
if (state.vehicles.size) p.set('agv', [...state.vehicles].join(','));
history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
}

/* ------------------------------------------------------------------ API */
async function api(path, params) {
const qs = params ? '?' + new URLSearchParams(params).toString() : '';
const r = await fetch(`${API}${path}${qs}`, { headers: { Accept: 'application/json' } });
const body = await r.json().catch(() => ({}));
if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
return body;
}
function filterParams() {
return { from: state.from, to: state.to, shift: state.shift, vehicles: [...state.vehicles].join(','), crews: sortedCrews().join(',') };
}
function sortedCrews() { return [...state.crews].sort((a, b) => a - b); }
function crewLabel(n) { return n == null ? 'bez plánu' : `${n}`; }

/* -------------------------------------------------------------- tooltip */
const tip = $('tooltip');
document.addEventListener('mousemove', (e) => {
const el = e.target.closest && e.target.closest('[data-tt]');
if (!el) { tip.hidden = true; return; }
tip.innerHTML = el.getAttribute('data-tt');
tip.hidden = false;
const w = tip.offsetWidth, h = tip.offsetHeight;
let x = e.clientX + 14, y = e.clientY + 14;
if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
tip.style.left = x + 'px'; tip.style.top = y + 'px';
});

/* -------------------------------------------------------------- filtry */
function renderShiftSeg() {
const opts = [['', 'Obě'], ['R', SHIFTS.R.label, SHIFTS.R.hours], ['N', SHIFTS.N.label, SHIFTS.N.hours]];
$('shiftSeg').innerHTML = opts.map(([v, l, h]) =>
`<button type="button" role="radio" data-shift="${v}" aria-checked="${state.shift === v}">${esc(l)}${h ? `<small>${esc(h)}</small>` : ''}</button>`
).join('');
}
function renderVehicleChips() {
const all = state.vehicles.size === 0;
const chips = [`<button type="button" class="chip" data-agv="" aria-pressed="${all}">Všechna AGV</button>`];
for (const v of state.vehicleList) {
const on = state.vehicles.has(v.vehicleName);
const place = v.placeOfUse ? `<small>${esc(v.placeOfUse)}</small>` : '';
chips.push(`<button type="button" class="chip" data-agv="${esc(v.vehicleName)}" aria-pressed="${on}"><span class="chip-dot"></span>${esc(v.vehicleName)}${place}</button>`);
}
$('vehicleChips').innerHTML = chips.join('');
}
function renderCrewChips() {
const all = state.crews.size === 0;
const btns = [`<button type="button" data-crew="" aria-pressed="${all}">Vše</button>`];
for (const c of state.crewList) {
btns.push(`<button type="button" data-crew="${c.shiftNumber}" aria-pressed="${state.crews.has(c.shiftNumber)}" data-tt="Směna č. ${c.shiftNumber}">${c.shiftNumber}</button>`);
}
$('crewChips').innerHTML = btns.join('');
$('crewGroup').hidden = !state.crewList.length;
}
function renderPlanNote() {
const notes = [];
if (state.crewList.length && state.planFrom && (state.from < state.planFrom || state.to > state.planTo)) {
notes.push(`Směnový plán pokrývá ${fmtDay(state.planFrom)} – ${fmtDay(state.planTo)}. Dny mimo plán nemají číslo směny${state.crews.size ? ', a proto se při filtru čísla směny nezapočítají' : ''}.`);
}
if (!state.crewList.length && state.planLoaded) {
notes.push('Směnový plán (dbo.shiftPlan12h) je prázdný nebo nedostupný – filtr čísla směny je skrytý.');
}
$('planNote').textContent = notes.join(' ');
$('planNote').hidden = !notes.length;
}
function renderQuick() {
const span = daysBetween(state.from, state.to) + 1;
const isMonth = state.from.slice(8) === '01' && state.to === lastOfMonth(state.from);
for (const b of $('quickRange').querySelectorAll('button')) {
const r = b.dataset.range;
const on = state.to === state.dataMax && ((r === 'day' && span === 1) || (+r === span && r !== 'month'));
b.setAttribute('aria-pressed', String(on || (r === 'month' && isMonth)));
}
}
function lastOfMonth(iso) {
const d = toDate(iso); d.setUTCMonth(d.getUTCMonth() + 1, 0); return toIso(d);
}
function syncFilterUi() {
$('dateFrom').value = state.from; $('dateTo').value = state.to;
$('dateFrom').min = $('dateTo').min = state.dataMin || '';
$('dateFrom').max = $('dateTo').max = state.dataMax || '';
renderShiftSeg(); renderCrewChips(); renderVehicleChips(); renderQuick(); renderPlanNote();
}

function bindFilters() {
$('dateFrom').addEventListener('change', (e) => {
if (!e.target.value) return;
state.from = e.target.value;
if (state.to < state.from) state.to = state.from;
changed();
});
$('dateTo').addEventListener('change', (e) => {
if (!e.target.value) return;
state.to = e.target.value;
if (state.from > state.to) state.from = state.to;
changed();
});
$('quickRange').addEventListener('click', (e) => {
const b = e.target.closest('button'); if (!b) return;
const end = state.dataMax || toIso(new Date());
const r = b.dataset.range;
if (r === 'day') { state.from = state.to = end; }
else if (r === 'month') { state.from = end.slice(0, 8) + '01'; state.to = end; }
else { state.to = end; state.from = addDays(end, -(+r - 1)); }
changed();
});
$('shiftSeg').addEventListener('click', (e) => {
const b = e.target.closest('button'); if (!b) return;
state.shift = b.dataset.shift; changed();
});
$('crewChips').addEventListener('click', (e) => {
const b = e.target.closest('button'); if (!b) return;
const c = b.dataset.crew ? Number(b.dataset.crew) : null;
if (c == null) state.crews.clear();
else if (state.crews.has(c)) state.crews.delete(c);
else state.crews.add(c);
if (state.crews.size === state.crewList.length) state.crews.clear();
changed();
});
$('vehicleChips').addEventListener('click', (e) => {
const b = e.target.closest('button'); if (!b) return;
const v = b.dataset.agv;
if (!v) state.vehicles.clear();
else if (e.ctrlKey || e.metaKey) { state.vehicles = new Set([v]); }
else if (state.vehicles.has(v)) state.vehicles.delete(v);
else state.vehicles.add(v);
// vsechna jednotlive oznacena = totez jako "Vsechna AGV"
if (state.vehicles.size === state.vehicleList.length) state.vehicles.clear();
changed();
});
}

let debounce;
function changed() {
syncFilterUi(); writeUrl();
clearTimeout(debounce);
debounce = setTimeout(loadData, 150);
}

/* ------------------------------------------------------------ nacitani */
async function init() {
$('year').textContent = new Date().getFullYear();
readUrl();
renderShiftSeg();
bindFilters();
bindMonitor();
const [veh, crews] = await Promise.allSettled([api('/vehicles'), api('/shift-numbers')]);
if (veh.status === 'fulfilled') state.vehicleList = veh.value;
else { showError(`Nepodařilo se načíst seznam AGV: ${veh.reason.message}`); state.vehicleList = []; }
state.crewList = crews.status === 'fulfilled' ? crews.value : [];
state.planLoaded = true;
if (state.crewList.length) {
state.planFrom = state.crewList.map((c) => c.firstDate).sort()[0];
state.planTo = state.crewList.map((c) => c.lastDate).sort().slice(-1)[0];
}
const known = new Set(state.crewList.map((c) => c.shiftNumber));
state.crews = new Set([...state.crews].filter((c) => known.has(c)));
const firsts = state.vehicleList.map((v) => v.firstDate).filter(Boolean).map((d) => String(d).slice(0, 10));
const lasts = state.vehicleList.map((v) => v.lastDate).filter(Boolean).map((d) => String(d).slice(0, 10));
state.dataMin = firsts.length ? firsts.sort()[0] : '';
state.dataMax = lasts.length ? lasts.sort().slice(-1)[0] : toIso(new Date(Date.now() - 86400000));

// vybrana AGV z URL, ktera uz neexistuji, zahodit
const names = new Set(state.vehicleList.map((v) => v.vehicleName));
state.vehicles = new Set([...state.vehicles].filter((v) => names.has(v)));

if (!state.to) state.to = state.dataMax;
if (!state.from) state.from = addDays(state.to, -((CFG.DEFAULT_DAYS || 7) - 1));
if (state.from > state.to) state.from = state.to;

$('dataStatus').textContent = state.dataMax ? `Data do ${fmtDay(state.dataMax)}` : 'Bez dat';
syncFilterUi(); writeUrl();
loadData();
}

async function loadData() {
const id = ++state.reqId;
document.body.classList.add('is-loading');
hideError();
const p = filterParams();
try {
const [status, summary, orders] = await Promise.all([
api('/status', p),
api('/orders/summary', p),
api('/orders', { ...p, limit: CFG.ORDER_LIMIT || 20000 }),
]);
if (id !== state.reqId) return; // mezitim prisel novejsi pozadavek
state.status = status;
state.summary = summary;
state.orders = orders.data || [];
state.ordersTotal = orders.total || state.orders.length;
state.page = 1;
renderAll();
} catch (err) {
if (id !== state.reqId) return;
showError(`Chyba při načítání dat: ${err.message}`);
} finally {
if (id === state.reqId) document.body.classList.remove('is-loading');
}
}

function showError(msg) { const b = $('errorBox'); b.textContent = msg; b.hidden = false; $('dataStatus').classList.add('is-error'); }
function hideError() { $('errorBox').hidden = true; $('dataStatus').classList.remove('is-error'); }

/* ------------------------------------------------------------ vypocty */
function emptyTotals() { const t = {}; for (const s of STATES) t[s.key] = 0; return t; }
function addTotals(t, row) { for (const s of STATES) t[s.key] += Number(row[s.key]) || 0; return t; }
function utilOf(t) {
const active = UTIL_ACTIVE.reduce((a, k) => a + (t[k] || 0), 0);
const denom = STATES.filter((s) => !UTIL_EXCLUDE.includes(s.key)).reduce((a, s) => a + (t[s.key] || 0), 0);
return { active, denom, util: pct(active, denom) };
}
function sumSummary(rows) {
const o = { orders: 0, finished: 0, operatingSec: 0, operatingCnt: 0, backlogSec: 0, backlogCnt: 0, distanceKm: 0, energyWh: 0 };
for (const r of rows) for (const k in o) o[k] += Number(r[k]) || 0;
return o;
}

/* ------------------------------------------------------------ render */
function renderAll() {
const totals = state.status.reduce(addTotals, emptyTotals());
const sum = sumSummary(state.summary);
renderKpis(totals, sum);
renderPie(totals);
renderOrdersByDay();
renderOrdersByHour();
renderUtilByDay();
renderVehicleTable();
renderOrders();
}

function renderKpis(t, sum) {
const u = utilOf(t);
const days = daysBetween(state.from, state.to) + 1;
const avgOp = sum.operatingCnt ? sum.operatingSec / sum.operatingCnt : null;
const avgWait = sum.backlogCnt ? sum.backlogSec / sum.backlogCnt : null;
const k = [
{ cls: 'kpi-main', label: 'Utilizace', value: u.util == null ? '–' : nf1.format(u.util), unit: u.util == null ? '' : '%',
note: 'jízda s / bez nákladu z celkového času' },
{ label: 'Hodin v provozu', value: nf1.format(hours(u.active)), unit: 'h', note: `z ${nf0.format(hours(u.denom))} h zaznamenaného času` },
{ cls: 'kpi-bad', label: 'Hodin v poruše', value: nf1.format(hours(t.failure)), unit: 'h',
note: `${fmtPct(pct(t.failure, u.denom))} času · překážky ${nf1.format(hours(t.obstruction))} h` },
{ label: 'Počet úkolů', value: nf0.format(sum.orders), unit: '', note: `${nf0.format(sum.orders / days)} za den` },
{ label: 'Ø doba úkolu', value: avgOp == null ? '–' : fmtDur(avgOp), unit: '', note: avgWait == null ? '' : `Ø čekání na start ${fmtDur(avgWait)}` },
{ label: 'Ujetá vzdálenost', value: nf1.format(sum.distanceKm), unit: 'km', note: `${nf1.format(sum.energyWh / 1000)} kWh` },
];
$('kpis').innerHTML = k.map((x) => `
<div class="kpi ${x.cls || ''}">
<div class="kpi-label">${esc(x.label)}</div>
<div class="kpi-value">${esc(x.value)}${x.unit ? `<small>${esc(x.unit)}</small>` : ''}</div>
<div class="kpi-note">${esc(x.note)}</div>
</div>`).join('');
}

/* ---- kolac ---- */
function renderPie(t) {
const u = utilOf(t);
const total = STATES.reduce((a, s) => a + t[s.key], 0);
const sel = state.vehicles.size ? [...state.vehicles].join(', ') : 'všechna AGV';
const crewTxt = state.crews.size ? ` · směna č. ${sortedCrews().join(', ')}` : '';
$('pieSub').textContent = `${sel} · ${state.shift ? SHIFTS[state.shift].label : 'obě směny'}${crewTxt}`;

if (!total) {
$('pieChart').innerHTML = '<div class="chart-empty">Žádná data o stavech</div>';
$('pieLegend').innerHTML = '';
return;
}
const cx = 150, cy = 150, R = 140, r = 88;
let a0 = -Math.PI / 2, paths = '';
const nonZero = STATES.filter((s) => t[s.key] > 0);
for (const s of nonZero) {
const v = t[s.key], frac = v / total;
const a1 = a0 + frac * Math.PI * 2;
const tt = `<b>${esc(s.label)}</b> (${esc(s.pbi)})<br>${nf1.format(hours(v))} h · ${fmtPct(frac * 100)}`;
if (nonZero.length === 1) {
paths += `<path class="slice" fill="${s.color}" data-tt="${esc(tt)}" fill-rule="evenodd" d="M${cx - R},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0"/>`;
} else {
const large = a1 - a0 > Math.PI ? 1 : 0;
const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
paths += `<path class="slice" fill="${s.color}" stroke="#fff" stroke-width="1.5" data-tt="${esc(tt)}" d="M${p(R, a0)}A${R},${R} 0 ${large},1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${large},0 ${p(r, a0)}Z"/>`;
}
a0 = a1;
}
$('pieChart').innerHTML = `
<svg viewBox="0 0 300 300" role="img" aria-label="Rozpad stavů AGV">
${paths}
<text x="150" y="150" text-anchor="middle" class="pie-center-value">${u.util == null ? '–' : nf1.format(u.util) + ' %'}</text>
<text x="150" y="172" text-anchor="middle" class="pie-center-label">utilizace</text>
</svg>`;

let group = '', li = '';
for (const s of STATES) {
if (s.group !== group) { group = s.group; li += `<li class="lg-group">${esc(group)}</li>`; }
const v = t[s.key];
li += `<li class="${v ? '' : 'is-zero'}" data-tt="${esc(s.pbi)}"><i style="background:${s.color}"></i><span>${esc(s.label)}</span>
<span class="lg-val">${nf1.format(hours(v))} h</span><span class="lg-pct">${fmtPct(pct(v, total))}</span></li>`;
}
$('pieLegend').innerHTML = li;
}

/* ---- obecny sloupcovy graf (skladane sloupce + volitelna cara) ----
cats: [{key,label,tt}] series: [{label,color,values[]}]
line: {label,color,values[], max, fmt} (prava osa) */
function barChart(el, cats, series, opt) {
opt = opt || {};
const totals = cats.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
const hasLine = opt.line && opt.line.values.some((v) => v != null);
if (!totals.some((v) => v > 0) && !hasLine) {
el.innerHTML = `<div class="chart-empty">${esc(opt.empty || 'Žádná data')}</div>`;
return;
}
const W = 640, H = 260, m = { t: 12, r: hasLine ? 44 : 12, b: 30, l: 44 };
const iw = W - m.l - m.r, ih = H - m.t - m.b;
const yMax = niceMax(Math.max(4, ...totals));
const n = cats.length, bw = iw / n, gap = Math.max(Math.min(6, bw * 0.25), bw - 56);
const y = (v) => m.t + ih - (v / yMax) * ih;

let g = '';
for (let i = 0; i <= 4; i++) {
const v = (yMax / 4) * i, yy = y(v);
g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
g += `<text x="${m.l - 6}" y="${yy + 4}" text-anchor="end">${esc((opt.yFmt || nf0.format)(v))}</text>`;
if (hasLine) {
const lv = (opt.line.max / 4) * i;
g += `<text x="${W - m.r + 6}" y="${yy + 4}" text-anchor="start">${esc(opt.line.fmt(lv))}</text>`;
}
}
const step = Math.max(1, Math.ceil(n / Math.floor(iw / 46)));
let bars = '', xl = '';
cats.forEach((c, i) => {
const x = m.l + i * bw + gap / 2;
let acc = 0;
const rows = series.map((s) => `<div class="tt-row"><span>${esc(s.label)}</span><b>${esc((opt.vFmt || nf0.format)(s.values[i] || 0))}</b></div>`).join('');
const lineRow = hasLine && opt.line.values[i] != null ? `<div class="tt-row"><span>${esc(opt.line.label)}</span><b>${esc(opt.line.fmt(opt.line.values[i]))}</b></div>` : '';
const tt = `<b>${esc(c.tt || c.label)}</b>${rows}${series.length > 1 ? `<div class="tt-row"><span>Celkem</span><b>${esc((opt.vFmt || nf0.format)(totals[i]))}</b></div>` : ''}${lineRow}`;
for (const s of series) {
const v = s.values[i] || 0;
if (v > 0) {
const y0 = y(acc + v), h = y(acc) - y0;
bars += `<rect class="bar" x="${x.toFixed(2)}" y="${y0.toFixed(2)}" width="${Math.max(1, bw - gap).toFixed(2)}" height="${Math.max(0.5, h).toFixed(2)}" fill="${s.color}" rx="${bw > 10 ? 2 : 0}"/>`;
}
acc += v;
}
// pruhledny obdelnik pres celou vysku = snadny hover
bars += `<rect x="${(m.l + i * bw).toFixed(2)}" y="${m.t}" width="${bw.toFixed(2)}" height="${ih}" fill="transparent" data-tt="${esc(tt)}"/>`;
if (i % step === 0) xl += `<text x="${(m.l + i * bw + bw / 2).toFixed(2)}" y="${H - m.b + 16}" text-anchor="middle">${esc(c.label)}</text>`;
});

let line = '';
if (hasLine) {
const ly = (v) => m.t + ih - (v / opt.line.max) * ih;
let d = '', dots = '';
opt.line.values.forEach((v, i) => {
if (v == null) return;
const x = m.l + i * bw + bw / 2;
d += `${d ? 'L' : 'M'}${x.toFixed(2)},${ly(v).toFixed(2)}`;
if (n <= 62) dots += `<circle cx="${x.toFixed(2)}" cy="${ly(v).toFixed(2)}" r="3" fill="#fff" stroke="${opt.line.color}" stroke-width="2" pointer-events="none"/>`;
});
line = `<path d="${d}" fill="none" stroke="${opt.line.color}" stroke-width="2.2" stroke-linejoin="round" pointer-events="none"/>${dots}`;
}

const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')
+ (hasLine ? `<span><i class="line" style="background:${opt.line.color}"></i>${esc(opt.line.label)}</span>` : '');
el.innerHTML = `
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || 'graf')}">
<g class="axis">${g}${xl}</g>${bars}${line}
</svg>
<div class="chart-legend">${legend}</div>`;
}
// Horni mez osy = 4 * "pekny" krok (1, 2, 2.5, 5 * 10^n), at jsou popisky celymi cisly.
function niceMax(v) {
const raw = v / 4;
const p = Math.pow(10, Math.floor(Math.log10(raw)));
for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= raw) return 4 * k * p;
return 40 * p;
}
function shiftSeries() {
return (state.shift ? [state.shift] : ['R', 'N']).map((k) => ({ key: k, label: SHIFTS[k].label, color: SHIFT_COLORS[k] }));
}

function renderOrdersByDay() {
const days = dateRange(state.from, state.to);
const idx = new Map(days.map((d, i) => [d, i]));
const series = shiftSeries().map((s) => ({ ...s, values: days.map(() => 0) }));
for (const r of state.summary) {
const i = idx.get(r.shiftDate); const s = series.find((x) => x.key === r.shift);
if (i != null && s) s.values[i] += Number(r.orders) || 0;
}
const cats = days.map((d) => ({ label: fmtDayShort(d), tt: fmtDay(d) }));
barChart($('ordersByDay'), cats, series, { aria: 'Úkoly po dnech', empty: 'Žádné úkoly v období' });
}

function renderOrdersByHour() {
// osa zacina zacatkem ranni smeny (6:00), at je den smeny vcelku
const order = Array.from({ length: 24 }, (_, i) => (i + 6) % 24);
const series = shiftSeries().map((s) => ({ ...s, values: order.map(() => 0) }));
for (const r of state.summary) {
const i = order.indexOf(Number(r.hour)); const s = series.find((x) => x.key === r.shift);
if (i >= 0 && s) s.values[i] += Number(r.orders) || 0;
}
const days = daysBetween(state.from, state.to) + 1;
const cats = order.map((h) => ({ label: String(h), tt: `${h}:00–${h}:59${days > 1 ? ` · Ø ${nf1.format(series.reduce((a, s) => a + s.values[order.indexOf(h)], 0) / days)} / den` : ''}` }));
barChart($('ordersByHour'), cats, series, { aria: 'Úkoly po hodinách', empty: 'Žádné úkoly v období' });
}

function renderUtilByDay() {
const days = dateRange(state.from, state.to);
const idx = new Map(days.map((d, i) => [d, i]));
const series = shiftSeries().map((s) => ({ ...s, label: `Porucha – ${s.label}`, color: s.key === 'R' ? '#e8836f' : '#9b2c20', values: days.map(() => 0) }));
const perDay = days.map(() => emptyTotals());
for (const r of state.status) {
const i = idx.get(String(r.statusDate).slice(0, 10)); if (i == null) continue;
addTotals(perDay[i], r);
const s = series.find((x) => x.key === r.shift);
if (s) s.values[i] += (Number(r.failure) || 0) / 60;
}
const util = perDay.map((t) => utilOf(t).util);
const cats = days.map((d) => ({ label: fmtDayShort(d), tt: fmtDay(d) }));
barChart($('utilByDay'), cats, series, {
aria: 'Utilizace a poruchy po dnech', empty: 'Žádná data o stavech',
vFmt: (v) => `${nf0.format(v)} min`, yFmt: (v) => nf0.format(v),
line: { label: 'Utilizace', color: '#00893d', values: util, max: 100, fmt: (v) => `${nf0.format(v)} %` },
});
}

/* ---- srovnani: po vozidlech / cislech smen / ranni-nocni ---- */
const COMPARE = {
vehicle: { title: 'AGV', key: (r) => r.vehicleName, label: (k) => `<b>${esc(k)}</b>`, sort: null },
crew: {
title: 'Číslo směny', key: (r) => (r.shiftNumber == null ? '' : String(r.shiftNumber)),
label: (k) => (k === '' ? '<span class="muted">bez plánu</span>' : `<span class="crew-tag">${esc(k)}</span>`),
sort: (a, b) => (a.name === '' ? 1 : b.name === '' ? -1 : a.name - b.name),
},
shift: {
title: 'Směna', key: (r) => r.shift || '',
label: (k) => `<span class="shift-tag"><i style="background:${SHIFT_COLORS[k] || '#999'}"></i>${esc(SHIFTS[k] ? SHIFTS[k].label : '?')}</span>`,
sort: (a, b) => (a.name === 'R' ? -1 : 1),
},
};
function renderVehicleTable() {
const cfg = COMPARE[state.compareBy];
const by = new Map();
const get = (n) => { if (!by.has(n)) by.set(n, { name: n, t: emptyTotals(), o: [] }); return by.get(n); };
for (const r of state.status) addTotals(get(cfg.key(r)).t, r);
for (const r of state.summary) get(cfg.key(r)).o.push(r);
const rows = [...by.values()].map((x) => ({ ...x, u: utilOf(x.t), s: sumSummary(x.o) }))
.sort(cfg.sort || ((a, b) => (b.u.util || 0) - (a.u.util || 0)));

const head = `<thead><tr><th>${esc(cfg.title)}</th><th>Utilizace</th><th class="num">Provoz h</th><th class="num">Nečinnost h</th>
<th class="num">Nabíjení h</th><th class="num">Porucha h</th><th class="num">Překážka h</th>
<th class="num">Úkoly</th><th class="num">Ø doba úkolu</th><th class="num">Ø čekání</th><th class="num">km</th></tr></thead>`;
if (!rows.length) { $('vehicleTable').innerHTML = head + '<tbody><tr><td class="tbl-msg" colspan="11">Žádná data</td></tr></tbody>'; return; }
const body = rows.map((x) => {
const u = x.u.util;
return `<tr><td>${cfg.label(x.name)}</td>
<td><span class="util-bar"><b style="width:${Math.min(100, u || 0).toFixed(1)}%"></b></span>${fmtPct(u)}</td>
<td class="num">${nf1.format(hours(x.u.active))}</td>
<td class="num">${nf1.format(hours(x.t.idle))}</td>
<td class="num">${nf1.format(hours(x.t.charging))}</td>
<td class="num">${nf1.format(hours(x.t.failure))}</td>
<td class="num">${nf1.format(hours(x.t.obstruction))}</td>
<td class="num">${nf0.format(x.s.orders)}</td>
<td class="num">${x.s.operatingCnt ? fmtDur(x.s.operatingSec / x.s.operatingCnt) : '–'}</td>
<td class="num">${x.s.backlogCnt ? fmtDur(x.s.backlogSec / x.s.backlogCnt) : '–'}</td>
<td class="num">${nf1.format(x.s.distanceKm)}</td></tr>`;
}).join('');
$('vehicleTable').innerHTML = head + `<tbody>${body}</tbody>`;
}

/* ---- monitor ukolu ---- */
const ORDER_STATES = [['all', 'Vše'], ['done', 'Dokončené'], ['run', 'Probíhá'], ['wait', 'Čeká']];
const ORDER_COLS = [
{ key: 'created', label: 'Vytvořeno' },
{ key: 'shift', label: 'Směna' },
{ key: 'shiftNumber', label: 'Č. směny', num: true },
{ key: 'vehicleName', label: 'AGV' },
{ key: 'source', label: 'Odkud' },
{ key: 'destination', label: 'Kam' },
{ key: 'finalDestination', label: 'Konečný cíl' },
{ key: 'backlogSec', label: 'Čekání', num: true },
{ key: 'operatingSec', label: 'Doba jízdy', num: true },
{ key: 'distanceKm', label: 'Vzdálenost m', num: true },
{ key: 'energyWh', label: 'Energie Wh', num: true },
{ key: 'state', label: 'Stav' },
{ key: 'orderID', label: 'ID úkolu' },
];
function orderState(o) { return o.ended ? 'done' : o.started ? 'run' : 'wait'; }

function bindMonitor() {
$('stateSeg').innerHTML = ORDER_STATES.map(([k, l]) => `<button type="button" role="radio" data-state="${k}" aria-checked="${k === 'all'}">${l}</button>`).join('');
$('stateSeg').addEventListener('click', (e) => {
const b = e.target.closest('button'); if (!b) return;
state.orderState = b.dataset.state; state.page = 1;
for (const x of $('stateSeg').children) x.setAttribute('aria-checked', String(x === b));
renderOrders();
});
let t;
$('orderSearch').addEventListener('input', (e) => {
clearTimeout(t);
t = setTimeout(() => { state.search = e.target.value.trim().toLowerCase(); state.page = 1; renderOrders(); }, 150);
});
$('ordersTable').addEventListener('click', (e) => {
const th = e.target.closest('th[data-sort]'); if (!th) return;
const k = th.dataset.sort;
if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = k === 'created' ? -1 : 1; }
renderOrders();
});
$('prevPage').addEventListener('click', () => { state.page--; renderOrders(); });
$('nextPage').addEventListener('click', () => { state.page++; renderOrders(); });
$('exportCsv').addEventListener('click', exportCsv);
$('compareSeg').addEventListener('click', (e) => {
const b = e.target.closest('button'); if (!b) return;
state.compareBy = b.dataset.by;
for (const x of $('compareSeg').children) x.setAttribute('aria-checked', String(x === b));
renderVehicleTable();
});
document.addEventListener('keydown', (e) => {
if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('orderSearch').focus(); }
});
}

function filteredOrders() {
const q = state.search;
let list = state.orders;
if (state.orderState !== 'all') list = list.filter((o) => orderState(o) === state.orderState);
if (q) list = list.filter((o) => [o.orderID, o.vehicleName, o.source, o.destination, o.finalDestination]
.some((v) => v && String(v).toLowerCase().includes(q)));
const k = state.sortKey, dir = state.sortDir;
const val = (o) => (k === 'state' ? orderState(o) : o[k]);
return [...list].sort((a, b) => {
const x = val(a), y = val(b);
if (x == null && y == null) return 0;
if (x == null) return 1;
if (y == null) return -1;
return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'cs')) * dir;
});
}

function renderOrders() {
const list = filteredOrders();
const per = CFG.ORDERS_PER_PAGE || 50;
const pages = Math.max(1, Math.ceil(list.length / per));
state.page = Math.min(Math.max(1, state.page), pages);
const slice = list.slice((state.page - 1) * per, state.page * per);

const truncated = state.ordersTotal > state.orders.length;
$('ordersInfo').textContent = truncated
? `zobrazeno nejnovějších ${nf0.format(state.orders.length)} z ${nf0.format(state.ordersTotal)} úkolů – zužte období`
: `${nf0.format(list.length)} úkolů${list.length !== state.orders.length ? ` z ${nf0.format(state.orders.length)}` : ''}`;

const head = '<thead><tr>' + ORDER_COLS.map((c) => {
const ind = state.sortKey === c.key ? `<span class="sort-ind">${state.sortDir > 0 ? '▲' : '▼'}</span>` : '';
return `<th class="sortable ${c.num ? 'num' : ''}" data-sort="${c.key}">${esc(c.label)}${ind}</th>`;
}).join('') + '</tr></thead>';

let body;
if (!slice.length) {
body = `<tr><td class="tbl-msg" colspan="${ORDER_COLS.length}">${state.orders.length ? 'Nic neodpovídá filtru' : 'Žádné úkoly v období'}</td></tr>`;
} else {
const badge = { done: '<span class="badge badge-done">Dokončeno</span>', run: '<span class="badge badge-run">Probíhá</span>', wait: '<span class="badge badge-wait">Čeká</span>' };
body = slice.map((o) => {
const sh = SHIFTS[o.shift];
return `<tr>
<td data-tt="${esc(`Vytvořeno ${fmtDateTime(o.created)}<br>Start ${fmtDateTime(o.started) || '–'}<br>Konec ${fmtDateTime(o.ended) || '–'}`)}">${esc(fmtDateTime(o.created))}</td>
<td><span class="shift-tag"><i style="background:${SHIFT_COLORS[o.shift] || '#999'}"></i>${esc(sh ? sh.label : '')}</span> <span class="muted">${esc(fmtDayShort(o.shiftDate))}</span></td>
<td class="num">${o.shiftNumber == null ? '<span class="muted">–</span>' : `<span class="crew-tag">${esc(o.shiftNumber)}</span>`}</td>
<td><b>${esc(o.vehicleName)}</b></td>
<td class="mono">${esc(o.source || '')}</td>
<td class="mono">${esc(o.destination || '')}</td>
<td class="mono">${esc(o.finalDestination || '')}</td>
<td class="num">${esc(fmtDur(o.backlogSec))}</td>
<td class="num">${esc(fmtDur(o.operatingSec))}</td>
<td class="num">${o.distanceKm == null ? '' : nf0.format(o.distanceKm * 1000)}</td>
<td class="num">${o.energyWh == null ? '' : nf1.format(o.energyWh)}</td>
<td>${badge[orderState(o)]}</td>
<td class="mono muted">${esc(o.orderID)}</td></tr>`;
}).join('');
}
$('ordersTable').innerHTML = head + `<tbody>${body}</tbody>`;
$('pageInfo').textContent = `Strana ${state.page} z ${pages}`;
$('prevPage').disabled = state.page <= 1;
$('nextPage').disabled = state.page >= pages;
$('exportCsv').disabled = !list.length;
}

function exportCsv() {
const list = filteredOrders();
const cols = ['orderID', 'vehicleName', 'shiftDate', 'shift', 'shiftNumber', 'created', 'started', 'ended', 'source', 'destination',
'finalDestination', 'backlogSec', 'operatingSec', 'distanceKm', 'energyWh'];
const cell = (v) => {
if (v == null) return '';
if (typeof v === 'number') return String(v).replace('.', ',');
const s = String(v);
return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const lines = [cols.concat('state').join(';')];
for (const o of list) {
lines.push(cols.map((c) => cell(c === 'shift' ? (SHIFTS[o.shift] || {}).label : o[c])).concat(orderState(o)).join(';'));
}
const blob = new Blob(['' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = `agv_ukoly_${state.from}_${state.to}${state.shift ? '_' + state.shift : ''}${state.crews.size ? '_smena' + sortedCrews().join('-') : ''}.csv`;
document.body.appendChild(a); a.click(); a.remove();
setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

init();
})();
