// controllers/agvUtilizationController.js
// Logika endpointu pro appku "agv-utilization" (vyuziti AGV, monitor ukolu).
// Cte tabulky:
// [dbo].[agvStatus] - casy stavu AGV v sekundach po dnech a smenach
// [dbo].[AGV_OrderStats] - jednotlive prepravni ukoly (ordery) AGV
// [dbo].[shiftPlan12h] - smenovy plan: cislo smeny (parta) pro den a smenu
// (import viz apps/agv-utilization/db/)
//
// Cesty (URL) a HTTP metody se NEresi tady, ale v routes/agvUtilization.js.
//
// Bezpecnost: datumy, smena a seznam vozidel prichazi od uzivatele, takze
// NIKDY nejdou primo do textu dotazu - jdou vyhradne jako pojmenovane
// parametry (@dateFrom, @dateTo, @shift, @veh0..@vehN). Prefix jmena
// parametru zamerne NENI "p"+cislo (koliduje s @P1 od msnodesqlv8).
//
// Smeny: dve 12h smeny. Ranni zacina v SHIFT_START_HOUR (06:00), nocni
// o 12 h pozdeji (18:00) a konci rano dalsiho dne. Nocni smena se pocita
// k DNI, KDY ZACALA (ukol vytvoreny 25.11. ve 02:00 patri do nocni smeny
// 24.11.). agvStatus ma smenu zapsanou primo ve sloupci Shift
// ('Ranní' / 'Nocní'); u AGV_OrderStats se smena dopocita z orderCreated_dt.
//
// Cislo smeny: plan se paruje pres (den smeny, kod smeny R/N) LEFT JOINem,
// takze data bez planu nezmizi - jen maji shiftNumber = NULL. Kdyz je
// zapnuty filtr cisel smen, takove radky do vysledku nepatri.
//
// Endpointy jsou READ-ONLY.

'use strict';

const { sql, poolPromise } = require('../services/db');

const T_STATUS = '[FSTASCM].[dbo].[agvStatus]';
const T_ORDERS = '[FSTASCM].[dbo].[AGV_OrderStats]';
const T_PLAN = '[FSTASCM].[dbo].[shiftPlan12h]';

// Zacatek ranni smeny (hodina, mistni cas). Delka smeny je 12 h.
const SHIFT_START_HOUR = 6;

const MAX_RANGE_DAYS = 400;
const MAX_VEHICLES = 50;
const MAX_CREW = 20;
const DEFAULT_ORDER_LIMIT = 5000;
const MAX_ORDER_LIMIT = 20000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------------------------------------------------------------------
Spolecne zpracovani filtru z query stringu:
from, to - YYYY-MM-DD (den smeny, vcetne)
shift - 'R' | 'N' | prazdne (obe smeny)
vehicles - seznam jmen oddeleny carkou (prazdne = vsechna AGV)
crews - cisla smen oddelena carkou, napr. "1,3" (prazdne = vsechna)
Vraci { ok:true, ... } nebo { ok:false, error }.
--------------------------------------------------------------------------- */
function parseFilters(query) {
const from = String(query.from || '').trim();
const to = String(query.to || '').trim();

if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
return { ok: false, error: 'Parametry from a to musi byt datum ve formatu YYYY-MM-DD.' };
}
const dFrom = new Date(`${from}T00:00:00Z`);
const dTo = new Date(`${to}T00:00:00Z`);
if (Number.isNaN(dFrom.getTime()) || Number.isNaN(dTo.getTime())) {
return { ok: false, error: 'Neplatne datum.' };
}
if (dTo < dFrom) {
return { ok: false, error: 'Datum "do" je pred datem "od".' };
}
if ((dTo - dFrom) / 86400000 > MAX_RANGE_DAYS) {
return { ok: false, error: `Obdobi muze mit nejvyse ${MAX_RANGE_DAYS} dni.` };
}

const shiftRaw = String(query.shift || '').trim().toUpperCase();
if (shiftRaw && shiftRaw !== 'R' && shiftRaw !== 'N') {
return { ok: false, error: 'Parametr shift muze byt R, N nebo prazdny.' };
}

const vehicles = String(query.vehicles || '')
.split(',')
.map(v => v.trim())
.filter(Boolean);
const unique = [...new Set(vehicles)];
if (unique.length > MAX_VEHICLES) {
return { ok: false, error: `Najednou lze vybrat nejvyse ${MAX_VEHICLES} vozidel.` };
}
if (unique.some(v => v.length > 100)) {
return { ok: false, error: 'Prilis dlouhe jmeno vozidla.' };
}

const crewsRaw = String(query.crews || '').split(',').map(v => v.trim()).filter(Boolean);
const crews = [...new Set(crewsRaw.map(Number))];
if (crews.some(n => !Number.isInteger(n) || n < 1 || n > MAX_CREW)) {
return { ok: false, error: `Parametr crews musi obsahovat cisla smen 1-${MAX_CREW}.` };
}

return { ok: true, from, to, shift: shiftRaw || null, vehicles: unique, crews };
}

/* Naplni request parametry z filtru a vrati SQL podminku pro vozidla
a cisla smen (obe pripadne "1 = 1"). Cislo smeny je vzdy p.ShiftNumber. */
function bindFilters(request, f, vehicleColumn) {
request.input('dateFrom', sql.Date, f.from);
request.input('dateTo', sql.Date, f.to);
request.input('shift', sql.Char(1), f.shift);
request.input('shiftStart', sql.Int, SHIFT_START_HOUR);

let cond = '1 = 1';
if (f.vehicles.length) {
const names = f.vehicles.map((v, i) => {
request.input(`veh${i}`, sql.NVarChar(100), v);
return `@veh${i}`;
});
cond = `${vehicleColumn} IN (${names.join(', ')})`;
}
if (f.crews.length) {
const nums = f.crews.map((n, i) => {
request.input(`crew${i}`, sql.TinyInt, n);
return `@crew${i}`;
});
cond += ` AND p.ShiftNumber IN (${nums.join(', ')})`;
}
return cond;
}

// Kod smeny z textu ve sloupci agvStatus.Shift ('Ranní' / 'Nocní' / 'Noční').
const STATUS_SHIFT_CODE = `
CASE
WHEN s.Shift LIKE N'Ran%' THEN 'R'
WHEN s.Shift LIKE N'No%' THEN 'N'
ELSE NULL
END`;

// Spolecna cast pro ordery: posun casu o zacatek ranni smeny -> z nej
// den smeny a kod smeny. Filtr na rozsah jde pres orderCreated_unix
// (realny sloupec), ne pres vypocitany orderCreated_dt.
const ORDERS_FROM = `
FROM ${T_ORDERS} o
CROSS APPLY (
SELECT DATEADD(HOUR, -@shiftStart, o.orderCreated_dt) AS shifted
) x
CROSS APPLY (
SELECT
CAST(x.shifted AS date) AS shiftDate,
CASE WHEN DATEPART(HOUR, x.shifted) < 12 THEN 'R' ELSE 'N' END AS shiftCode
) sh
LEFT JOIN ${T_PLAN} p
ON p.ShiftDate = sh.shiftDate AND p.ShiftCode = sh.shiftCode`;

// Hranice obdobi prevedene na unix sekundy (mistni cas -> UTC).
const ORDERS_RANGE_DECLARE = `
DECLARE @fromLocal datetime2(0) = DATEADD(HOUR, @shiftStart, CAST(@dateFrom AS datetime2(0)));
DECLARE @toLocal datetime2(0) = DATEADD(HOUR, @shiftStart, CAST(DATEADD(DAY, 1, @dateTo) AS datetime2(0)));
DECLARE @fromUnix bigint = DATEDIFF_BIG(SECOND, CAST('19700101' AS datetime2(0)),
CAST((@fromLocal AT TIME ZONE 'Central European Standard Time') AT TIME ZONE 'UTC' AS datetime2(0)));
DECLARE @toUnix bigint = DATEDIFF_BIG(SECOND, CAST('19700101' AS datetime2(0)),
CAST((@toLocal AT TIME ZONE 'Central European Standard Time') AT TIME ZONE 'UTC' AS datetime2(0)));`;

function ordersWhere(vehCond) {
return `
WHERE o.orderCreated_unix >= @fromUnix - 7200
AND o.orderCreated_unix < @toUnix + 7200
AND sh.shiftDate BETWEEN @dateFrom AND @dateTo
AND (@shift IS NULL OR sh.shiftCode = @shift)
AND ${vehCond}`;
}

/* ===========================================================================
GET /api/v1/agv-utilization/vehicles
---------------------------------------------------------------------------
Seznam vozidel pro tlacitka ve filtru. Bere jmena z agvStatus i z
AGV_OrderStats (vozidlo muze mit ukoly driv, nez ma zaznam stavu).
Datumy u ukolu jsou dny smeny (nocni smena po pulnoci = predchozi den).
=========================================================================== */
async function getVehicles(req, res, next) {
try {
const pool = await poolPromise;
const result = await pool.request().query(`
SELECT
v.vehicleName,
MAX(v.placeOfUse) AS placeOfUse,
MIN(v.firstDate) AS firstDate,
MAX(v.lastDate) AS lastDate
FROM (
SELECT
CAST(s.VehicleName AS nvarchar(100)) AS vehicleName,
s.PlaceOfUse AS placeOfUse,
MIN(s.StatusDate) AS firstDate,
MAX(s.StatusDate) AS lastDate
FROM ${T_STATUS} s
WHERE s.VehicleName IS NOT NULL
GROUP BY s.VehicleName, s.PlaceOfUse
UNION ALL
SELECT
o.vehicleName,
NULL,
CAST(DATEADD(HOUR, -${SHIFT_START_HOUR}, MIN(o.orderCreated_dt)) AS date),
CAST(DATEADD(HOUR, -${SHIFT_START_HOUR}, MAX(o.orderCreated_dt)) AS date)
FROM ${T_ORDERS} o
GROUP BY o.vehicleName
) v
GROUP BY v.vehicleName
ORDER BY v.vehicleName;`);

res.status(200).json({ count: result.recordset.length, data: result.recordset });
} catch (err) {
next(err);
}
}

/* ===========================================================================
GET /api/v1/agv-utilization/status?from=&to=&shift=&vehicles=
---------------------------------------------------------------------------
Soucty casu ve stavech (sekundy) po dni, smene a vozidle. Frontend z toho
sklada kolacovy graf, KPI a graf poruch. Stejne jako Power BI se secitaji
vsechny radky agvStatus (vcetne castecnych zaznamu za stejnou smenu).
=========================================================================== */
async function getStatus(req, res, next) {
const f = parseFilters(req.query);
if (!f.ok) return res.status(400).json({ error: f.error });

try {
const pool = await poolPromise;
const request = pool.request();
const vehCond = bindFilters(request, f, 's.VehicleName');

const result = await request.query(`
SELECT
CONVERT(char(10), s.StatusDate, 23) AS statusDate,
sc.shiftCode AS shift,
s.VehicleName AS vehicleName,
p.ShiftNumber AS shiftNumber,
SUM(CAST(ISNULL(s.ActiveFullStatus, 0) AS bigint)) AS activeFull,
SUM(CAST(ISNULL(s.ActiveEmptyStatus, 0) AS bigint)) AS activeEmpty,
SUM(CAST(ISNULL(s.IdleStatus, 0) AS bigint)) AS idle,
SUM(CAST(ISNULL(s.ChargingStatus, 0) AS bigint)) AS charging,
SUM(CAST(ISNULL(s.PauseStatus, 0) AS bigint)) AS pause,
SUM(CAST(ISNULL(s.ObstructionStatus, 0) AS bigint)) AS obstruction,
SUM(CAST(ISNULL(s.ManualStatus, 0) AS bigint)) AS manual,
SUM(CAST(ISNULL(s.FailureStatus, 0) AS bigint)) AS failure,
SUM(CAST(ISNULL(s.OfflineStatus, 0) AS bigint)) AS offline
FROM ${T_STATUS} s
CROSS APPLY (SELECT ${STATUS_SHIFT_CODE} AS shiftCode) sc
LEFT JOIN ${T_PLAN} p
ON p.ShiftDate = s.StatusDate AND p.ShiftCode = sc.shiftCode
WHERE s.StatusDate BETWEEN @dateFrom AND @dateTo
AND (@shift IS NULL OR sc.shiftCode = @shift)
AND ${vehCond}
GROUP BY s.StatusDate, sc.shiftCode, s.VehicleName, p.ShiftNumber
ORDER BY s.StatusDate, sc.shiftCode, s.VehicleName;`);

res.status(200).json({ count: result.recordset.length, data: result.recordset });
} catch (err) {
next(err);
}
}

/* ===========================================================================
GET /api/v1/agv-utilization/orders/summary?from=&to=&shift=&vehicles=
---------------------------------------------------------------------------
Agregace ukolu po dni smeny, smene, hodine vytvoreni a vozidle. Z toho
frontend kresli "ukoly po dnech", "ukoly po hodinach" a KPI.
=========================================================================== */
async function getOrdersSummary(req, res, next) {
const f = parseFilters(req.query);
if (!f.ok) return res.status(400).json({ error: f.error });

try {
const pool = await poolPromise;
const request = pool.request();
const vehCond = bindFilters(request, f, 'o.vehicleName');

const result = await request.query(`
${ORDERS_RANGE_DECLARE}
SELECT
CONVERT(char(10), sh.shiftDate, 23) AS shiftDate,
sh.shiftCode AS shift,
DATEPART(HOUR, o.orderCreated_dt) AS hour,
o.vehicleName AS vehicleName,
p.ShiftNumber AS shiftNumber,
COUNT(*) AS orders,
SUM(CASE WHEN o.orderEnd_unix IS NOT NULL THEN 1 ELSE 0 END) AS finished,
SUM(CAST(ISNULL(o.orderOperatingTime_sec, 0) AS float)) AS operatingSec,
SUM(CASE WHEN o.orderOperatingTime_sec IS NOT NULL THEN 1 ELSE 0 END) AS operatingCnt,
SUM(CAST(ISNULL(o.orderBacklog_sec, 0) AS float)) AS backlogSec,
SUM(CASE WHEN o.orderBacklog_sec IS NOT NULL THEN 1 ELSE 0 END) AS backlogCnt,
SUM(CAST(ISNULL(o.orderDistanceTraveled_km, 0) AS float)) AS distanceKm,
SUM(ABS(CAST(ISNULL(o.orderPowerConsumed_Wh, 0) AS float))) AS energyWh
${ORDERS_FROM}
${ordersWhere(vehCond)}
GROUP BY sh.shiftDate, sh.shiftCode, DATEPART(HOUR, o.orderCreated_dt), o.vehicleName, p.ShiftNumber
ORDER BY sh.shiftDate, sh.shiftCode, hour, o.vehicleName;`);

res.status(200).json({ count: result.recordset.length, data: result.recordset });
} catch (err) {
next(err);
}
}

/* ===========================================================================
GET /api/v1/agv-utilization/orders?from=&to=&shift=&vehicles=&limit=
---------------------------------------------------------------------------
Jednotlive ukoly pro monitor ukolu, od nejnovejsiho. orderID je bigint
vetsi nez 2^53, proto jde ven jako text (jinak by ho JavaScript zaokrouhlil).
Vraci i celkovy pocet, at frontend vi, ze je seznam oriznuty limitem.
=========================================================================== */
async function getOrders(req, res, next) {
const f = parseFilters(req.query);
if (!f.ok) return res.status(400).json({ error: f.error });

let limit = parseInt(req.query.limit, 10);
if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_ORDER_LIMIT;
limit = Math.min(limit, MAX_ORDER_LIMIT);

try {
const pool = await poolPromise;
const request = pool.request();
const vehCond = bindFilters(request, f, 'o.vehicleName');
request.input('limit', sql.Int, limit);

const result = await request.query(`
${ORDERS_RANGE_DECLARE}
SELECT COUNT(*) AS total
${ORDERS_FROM}
${ordersWhere(vehCond)};

SELECT TOP (@limit)
CAST(o.orderID AS varchar(20)) AS orderID,
o.vehicleName,
CONVERT(char(10), sh.shiftDate, 23) AS shiftDate,
sh.shiftCode AS shift,
p.ShiftNumber AS shiftNumber,
CONVERT(varchar(19), o.orderCreated_dt, 126) AS created,
CONVERT(varchar(19), o.orderStart_dt, 126) AS started,
CONVERT(varchar(19), o.orderEnd_dt, 126) AS ended,
o.orderBacklog_sec AS backlogSec,
CAST(o.orderOperatingTime_sec AS float) AS operatingSec,
CAST(o.orderDistanceTraveled_km AS float) AS distanceKm,
ABS(CAST(o.orderPowerConsumed_Wh AS float)) AS energyWh,
o.source,
RTRIM(o.destination) AS destination,
o.finalDestination
${ORDERS_FROM}
${ordersWhere(vehCond)}
ORDER BY o.orderCreated_unix DESC, o.orderID DESC;`);

const total = result.recordsets[0][0] ? result.recordsets[0][0].total : 0;
const data = result.recordsets[1] || [];

res.status(200).json({ total, count: data.length, limit, data });
} catch (err) {
next(err);
}
}

/* ===========================================================================
GET /api/v1/agv-utilization/shift-numbers
---------------------------------------------------------------------------
Cisla smen ze smenoveho planu (pro tlacitka filtru) + rozsah planu, at
frontend umi upozornit, kdyz vybrane obdobi planem pokryte neni.
=========================================================================== */
async function getShiftNumbers(req, res, next) {
try {
const pool = await poolPromise;
const result = await pool.request().query(`
SELECT
p.ShiftNumber AS shiftNumber,
COUNT(*) AS shifts,
CONVERT(char(10), MIN(p.ShiftDate), 23) AS firstDate,
CONVERT(char(10), MAX(p.ShiftDate), 23) AS lastDate
FROM ${T_PLAN} p
GROUP BY p.ShiftNumber
ORDER BY p.ShiftNumber;`);

res.status(200).json({ count: result.recordset.length, data: result.recordset });
} catch (err) {
next(err);
}
}

module.exports = {
getVehicles,
getShiftNumbers,
getStatus,
getOrdersSummary,
getOrders,
// export pro testy
_parseFilters: parseFilters,
SHIFT_START_HOUR,
};
