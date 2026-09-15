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
const T_VYJIMKY = `${SCHEMA}.[vyjimky]`;
const T_POTREBY_SRC = `${SCHEMA}.[potreby]`;
const T_AKT = `${SCHEMA}.[aktualni_hladiny]`;
const T_NOVE = `${SCHEMA}.[nove_hladiny]`;
const T_META = `${SCHEMA}.[vypocet_meta]`;

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
p.avg_weekly,
CASE WHEN x.material IS NULL THEN 0 ELSE 1 END AS is_vyjimka
FROM ${T_VYPOCET} AS v
LEFT JOIN ${SCHEMA}.[aktualni_hladiny] AS ah ON ah.material = v.material
LEFT JOIN (
SELECT material, AVG(CAST(requirement_qty AS DECIMAL(18,3))) AS avg_weekly
FROM ${T_POTREBY}
GROUP BY material
) AS p ON p.material = v.material
LEFT JOIN ${T_VYJIMKY} AS x ON x.material = v.material
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


/* ===========================================================================
GET /api/v1/warehouse-hladiny/vyjimky - seznam vyjimek
=========================================================================== */
async function getVyjimky(req, res, next) {
try {
const pool = await poolPromise;
const result = await pool.request().query(
`SELECT material, poznamka, created_at, created_by FROM ${T_VYJIMKY} ORDER BY material;`);
res.status(200).json({ count: result.recordset.length, data: result.recordset });
} catch (err) { next(err); }
}

/* ===========================================================================
POST /api/v1/warehouse-hladiny/vyjimky { material, zapnuto, poznamka, uzivatel }
Prepina vyjimku pro jeden material. Zapis je idempotentni.
=========================================================================== */
async function setVyjimka(req, res, next) {
const material = String((req.body && req.body.material) || '').trim();
const zapnuto = !!(req.body && req.body.zapnuto);
const poznamka = (req.body && req.body.poznamka) || null;
const uzivatel = (req.body && req.body.uzivatel) || null;

if (!material) return res.status(400).json({ error: 'Chybi material.' });

try {
const pool = await poolPromise;
const rq = pool.request()
.input('material', sql.VarChar(40), material)
.input('poznamka', sql.NVarChar(200), poznamka)
.input('uzivatel', sql.NVarChar(128), uzivatel);

if (zapnuto) {
await rq.query(`
IF NOT EXISTS (SELECT 1 FROM ${T_VYJIMKY} WHERE material = @material)
INSERT INTO ${T_VYJIMKY} (material, poznamka, created_by)
VALUES (@material, @poznamka, @uzivatel);`);
} else {
await rq.query(`DELETE FROM ${T_VYJIMKY} WHERE material = @material;`);
}
res.status(200).json({ material, zapnuto });
} catch (err) { next(err); }
}

/* ===========================================================================
POST /api/v1/warehouse-hladiny/vyjimky/hromadne
{ materials: [...], zapnuto: bool, poznamka, uzivatel }
Hromadne nastaveni/zruseni vyjimky. Zapisuje po davkach (CHUNK), aby
dotaz nenarazil na limit parametru ani na delku SQL.
=========================================================================== */
async function setVyjimkyHromadne(req, res, next) {
const body = req.body || {};
const zapnuto = !!body.zapnuto;
const poznamka = body.poznamka || null;
const uzivatel = body.uzivatel || null;
const materials = Array.isArray(body.materials)
? Array.from(new Set(body.materials.map((m) => String(m || '').trim()).filter(Boolean)))
: [];

if (!materials.length) return res.status(400).json({ error: 'Chybi seznam materialu.' });

const CHUNK = 500;
try {
const pool = await poolPromise;
let zpracovano = 0;

for (let i = 0; i < materials.length; i += CHUNK) {
const davka = materials.slice(i, i + CHUNK);
const rq = pool.request();
const jmena = davka.map((m, j) => {
rq.input('m' + j, sql.VarChar(40), m);
return '@m' + j;
});
rq.input('poznamka', sql.NVarChar(200), poznamka);
rq.input('uzivatel', sql.NVarChar(128), uzivatel);

if (zapnuto) {
// vlozime jen ty, ktere jeste vyjimku nemaji (idempotentne)
await rq.query(`
INSERT INTO ${T_VYJIMKY} (material, poznamka, created_by)
SELECT x.material, @poznamka, @uzivatel
FROM (VALUES ${jmena.map((n) => `(${n})`).join(',')}) AS x(material)
WHERE NOT EXISTS (SELECT 1 FROM ${T_VYJIMKY} v WHERE v.material = x.material);`);
} else {
await rq.query(`DELETE FROM ${T_VYJIMKY} WHERE material IN (${jmena.join(',')});`);
}
zpracovano += davka.length;
}

res.status(200).json({ zpracovano, zapnuto });
} catch (err) { next(err); }
}

/* ===========================================================================
GET /api/v1/warehouse-hladiny/zdroje
---------------------------------------------------------------------------
Kdy naposledy dorazila data do kazdeho ze tri zdrojovych reportu.
Frontend podle toho ukazuje, ze ceho je vypocet postaveny.
=========================================================================== */
const SQL_ZDROJE = `
SELECT 'potreby' AS zdroj, MAX(loaded_at) AS loaded_at, COUNT(*) AS pocet FROM ${T_POTREBY_SRC}
UNION ALL
SELECT 'aktualni_hladiny', MAX(loaded_at), COUNT(*) FROM ${T_AKT}
UNION ALL
SELECT 'nove_hladiny', MAX(loaded_at), COUNT(*) FROM ${T_NOVE}`;

async function getZdroje(req, res, next) {
try {
const pool = await poolPromise;

// snapshot ulozeny u posledniho behu = z ceho vypocet REALNE vznikl
const beh = await pool.request().query(`
DECLARE @run DATETIME2(0) = (SELECT MAX(run_at) FROM ${T_VYPOCET});
SELECT @run AS run_at, zdroj, loaded_at, pocet_radku
FROM ${T_META} WHERE run_at = @run ORDER BY zdroj;`);

// aktualni stav tabulek = co lezi v DB ted
const ted = await pool.request().query(SQL_ZDROJE + ';');

res.status(200).json({
run_at: beh.recordset.length ? beh.recordset[0].run_at : null,
beh: beh.recordset,
aktualni: ted.recordset,
});
} catch (err) { next(err); }
}

/* ===========================================================================
POST /api/v1/warehouse-hladiny/prepocet
---------------------------------------------------------------------------
Spusti usp_vypocet_hladin a vrati novy run_at + stari zdrojovych dat.
Procedura bezi nad tisici materialu, proto vlastni (delsi) timeout.
=========================================================================== */
async function spustVypocet(req, res, next) {
try {
const pool = await poolPromise;

const rq = pool.request();
rq.timeout = 10 * 60 * 1000; // 10 minut, default poolu by nestacil
await rq.execute(`${SCHEMA}.[usp_vypocet_hladin]`);

const po = await pool.request().query(`
SELECT MAX(run_at) AS run_at, COUNT(*) AS pocet_celkem
FROM ${T_VYPOCET}
WHERE run_at = (SELECT MAX(run_at) FROM ${T_VYPOCET});`);

const runAt = po.recordset[0] ? po.recordset[0].run_at : null;

// Ulozime snapshot stari zdroju k tomuto behu. Diky tomu appka pozna,
// ze se zdroje od vypoctu zmenily, misto aby michala ruzne stara data.
if (runAt) {
await pool.request()
.input('run', sql.DateTime2, runAt)
.query(`
DELETE FROM ${T_META} WHERE run_at = @run;
INSERT INTO ${T_META} (run_at, zdroj, loaded_at, pocet_radku)
SELECT @run, zdroj, loaded_at, pocet FROM (${SQL_ZDROJE}) AS z;`);
}

const zdroje = await pool.request().query(`
SELECT zdroj, loaded_at, pocet_radku AS pocet FROM ${T_META}
WHERE run_at = (SELECT MAX(run_at) FROM ${T_VYPOCET}) ORDER BY zdroj;`);

res.status(200).json({
run_at: runAt,
pocet_celkem: po.recordset[0] ? po.recordset[0].pocet_celkem : 0,
zdroje: zdroje.recordset,
});
} catch (err) { next(err); }
}

module.exports = {
getRuns,
getVypocet,
getVyjimky,
setVyjimka,
setVyjimkyHromadne,
getZdroje,
spustVypocet,
getSummary,
getMaterialDetail,
};
