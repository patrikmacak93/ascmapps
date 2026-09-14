// controllers/warehouseHladinyController.js
// Logika endpointu pro appku "warehouse-hladiny" (skladove hladiny).
// Cte vysledky vypoctu ze schematu skladyHladiny (viz
// apps/warehouse-hladiny/sql-technicka-dokumentace.md).
//
// Cesty (URL) a HTTP metody se NEResi tady, ale v routes/warehouseHladiny.js.
//
// Bezpecnost: material a run_at prichazi od uzivatele, takze NIKDY nejdou
// primo do textu dotazu - jdou vyhradne jako pojmenovane parametry
// (@material, @run). Stejny princip jako v outboundPnzController.js /
// pckDatabaseController.js. Prefix jmena parametru zamerne NENI "p"+cislo
// (koliduje s @P1 od msnodesqlv8).
//
// Endpointy jsou READ-ONLY - tahle appka jen vizualizuje navrh vypoctu.
// Schvalovani a export do SAPu resi zamerne procedury v DB (usp_export_hladiny),
// ne tenhle connector.

'use strict';

const { sql, poolPromise } = require('../services/db');

const SCHEMA = '[FSTASCM].[skladyHladiny]';
const T_VYPOCET = `${SCHEMA}.[vypocet_hladin]`;
const T_POTREBY = `${SCHEMA}.[potreby]`;

// Spolecny SELECT sloupcu z vypocet_hladin, at je vsude stejne poradi.
const VYPOCET_COLS = `
run_at, material, current_level, q3, pct_change, new_level, action_label,
approved_at, approved_by, exported_at`;

/* ===========================================================================
GET /api/v1/warehouse-hladiny/runs
---------------------------------------------------------------------------
Seznam behu vypoctu (distinct run_at) od nejnovejsiho. Slouzi frontendu
k vyberu behu ve vyberovem poli. U kazdeho behu i par cisel do popisku:
kolik radku celkem, kolik z toho realnych zmen, a zda uz je cely beh
schvaleny / exportovany.
=========================================================================== */
async function getRuns(req, res, next) {
try {
const pool = await poolPromise;

const result = await pool.request().query(`
SELECT
run_at,
COUNT(*) AS pocet_celkem,
SUM(CASE
WHEN new_level IS NOT NULL
AND (current_level IS NULL OR new_level <> current_level)
THEN 1 ELSE 0 END) AS pocet_zmen,
SUM(CASE WHEN approved_at IS NULL THEN 0 ELSE 1 END) AS pocet_schvalenych,
SUM(CASE WHEN exported_at IS NULL THEN 0 ELSE 1 END) AS pocet_exportovanych
FROM ${T_VYPOCET}
GROUP BY run_at
ORDER BY run_at DESC`);

res.status(200).json({
count: result.recordset.length,
data: result.recordset,
});
} catch (err) {
next(err);
}
}

/* ===========================================================================
GET /api/v1/warehouse-hladiny/vypocet?run_at=...
---------------------------------------------------------------------------
Vsechny radky jednoho behu (nejen zmeny - i "Beze zmeny", at je videt
cely obraz). Kdyz run_at chybi, vezme se automaticky posledni beh.
Radi se podle action_label a materialu - stejne jako vraci sama procedura.
=========================================================================== */
async function getVypocet(req, res, next) {
const runAt = (req.query.run_at || '').trim() || null;

try {
const pool = await poolPromise;

const result = await pool
.request()
.input('run', sql.DateTime2, runAt)
.query(`
DECLARE @target DATETIME2(0) = @run;
IF @target IS NULL
SET @target = (SELECT MAX(run_at) FROM ${T_VYPOCET});

SELECT v.run_at, v.material, v.current_level, v.q3, v.pct_change, v.new_level,
v.action_label, v.approved_at, v.approved_by, v.exported_at,
ah.storage_type,
p.avg_weekly
FROM ${T_VYPOCET} AS v
LEFT JOIN ${SCHEMA}.[aktualni_hladiny] AS ah ON ah.material = v.material
LEFT JOIN (
SELECT material, AVG(CAST(requirement_qty AS DECIMAL(18,3))) AS avg_weekly
FROM ${T_POTREBY}
GROUP BY material
) AS p ON p.material = v.material
WHERE v.run_at = @target
ORDER BY v.action_label, v.material;`);

res.status(200).json({
count: result.recordset.length,
run_at: result.recordset.length ? result.recordset[0].run_at : null,
data: result.recordset,
});
} catch (err) {
next(err);
}
}

/* ===========================================================================
GET /api/v1/warehouse-hladiny/summary?run_at=...
---------------------------------------------------------------------------
Agregace jednoho behu po slovnich duvodech (action_label) - podklad pro
prehledovy graf/karty na frontendu. Kdyz run_at chybi, posledni beh.
=========================================================================== */
async function getSummary(req, res, next) {
const runAt = (req.query.run_at || '').trim() || null;

try {
const pool = await poolPromise;

const result = await pool
.request()
.input('run', sql.DateTime2, runAt)
.query(`
DECLARE @target DATETIME2(0) = @run;
IF @target IS NULL
SET @target = (SELECT MAX(run_at) FROM ${T_VYPOCET});

SELECT
action_label,
COUNT(*) AS pocet
FROM ${T_VYPOCET}
WHERE run_at = @target
GROUP BY action_label
ORDER BY pocet DESC;`);

res.status(200).json({
count: result.recordset.length,
data: result.recordset,
});
} catch (err) {
next(err);
}
}

/* ===========================================================================
GET /api/v1/warehouse-hladiny/material?material=...&run_at=...
---------------------------------------------------------------------------
Detail jednoho materialu = podklad pro vizualizaci VYPOCTU:
- vypocet : radek z vypocet_hladin (current_level, q3, new_level,
pct_change, action_label, stav schvaleni/exportu),
- potreby : vsech (az) 18 tydnu potreb pro ten material.

POZOR: tabulka potreby se importuje plnym refreshem a nenese run_at -
je to VZDY posledni import. Pro nejnovejsi beh sedi presne; u starsiho
behu je to nejblizsi dostupny obraz potreb (frontend na to upozorni).
=========================================================================== */
async function getMaterialDetail(req, res, next) {
const material = (req.query.material || '').trim();
const runAt = (req.query.run_at || '').trim() || null;

if (!material) {
return res.status(400).json({ error: 'Chybi parametr material.' });
}

try {
const pool = await poolPromise;

const vypocetResult = await pool
.request()
.input('material', sql.NVarChar, material)
.input('run', sql.DateTime2, runAt)
.query(`
DECLARE @target DATETIME2(0) = @run;
IF @target IS NULL
SET @target = (SELECT MAX(run_at) FROM ${T_VYPOCET});

SELECT ${VYPOCET_COLS}
FROM ${T_VYPOCET}
WHERE material = @material AND run_at = @target;`);

const potrebyResult = await pool
.request()
.input('material', sql.NVarChar, material)
.query(`
SELECT period_index, period_label, requirement_qty
FROM ${T_POTREBY}
WHERE material = @material
ORDER BY period_index;`);

if (!vypocetResult.recordset.length && !potrebyResult.recordset.length) {
return res.status(404).json({ error: `Material "${material}" nenalezen.` });
}

res.status(200).json({
material,
vypocet: vypocetResult.recordset[0] || null,
potreby: potrebyResult.recordset,
});
} catch (err) {
next(err);
}
}

module.exports = {
getRuns,
getVypocet,
getSummary,
getMaterialDetail,
};
