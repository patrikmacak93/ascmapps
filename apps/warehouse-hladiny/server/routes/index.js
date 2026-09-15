/*
============================================================
API ROUTY APLIKACE WAREHOUSE-HLADINY
============================================================
Uloha tohoto backendu: prijmout od frontendu pozadavek, zeptat se
sql-connectoru (ktery jediny saha do DB) a vratit vysledek. Sam se
do databaze nepripojuje - to dela vyhradne sql-connector (pres
sql_connector-klient.js, ktery pridava API klic).

Vsechny routy jsou READ-ONLY (GET) - appka jen vizualizuje navrh
vypoctu hladin. Schvalovani/export do SAPu resi zamerne procedury
v DB, ne tenhle web.

Mapovani (frontend ./api/... -> connector /api/v1/...):
GET /api/runs -> /warehouse-hladiny/runs
GET /api/vypocet?run_at=... -> /warehouse-hladiny/vypocet
GET /api/summary?run_at=... -> /warehouse-hladiny/summary
GET /api/material?material=&run_at=-> /warehouse-hladiny/material
*/

'use strict';

const express = require('express');

const { volatConnector } = require('../services/sql_connector-klient');

const router = express.Router();

/** Sjednocene odeslani chyby klientovi + zapis do logu serveru. */
function chyba(res, kde, err, zprava) {
console.error(`CHYBA ${kde}:`, err.message);
res.status(err.statusCode || 500).json({ error: zprava, detail: err.message });
}

/* GET /api/runs - seznam behu vypoctu (pro vyber behu) */
router.get('/runs', async (req, res) => {
try {
const vysledek = await volatConnector('/warehouse-hladiny/runs');
res.set('Cache-Control', 'no-store');
res.json(vysledek.data || []);
} catch (err) {
chyba(res, 'GET /runs', err, 'Chyba pri nacitani behu vypoctu.');
}
});

/* GET /api/vypocet?run_at=... - radky jednoho behu (tabulka) */
router.get('/vypocet', async (req, res) => {
const runAt = (req.query.run_at || '').trim();
try {
const vysledek = await volatConnector('/warehouse-hladiny/vypocet', {
query: { run_at: runAt },
});
res.set('Cache-Control', 'no-store');
// Predame i rozpoznany run_at, at frontend vi, ktery beh se realne vratil.
res.json({ run_at: vysledek.run_at || null, data: vysledek.data || [] });
} catch (err) {
chyba(res, 'GET /vypocet', err, 'Chyba pri nacitani vypoctu hladin.');
}
});

/* GET /api/summary?run_at=... - agregace po duvodech (graf/karty) */
router.get('/summary', async (req, res) => {
const runAt = (req.query.run_at || '').trim();
try {
const vysledek = await volatConnector('/warehouse-hladiny/summary', {
query: { run_at: runAt },
});
res.set('Cache-Control', 'no-store');
res.json(vysledek.data || []);
} catch (err) {
chyba(res, 'GET /summary', err, 'Chyba pri nacitani souhrnu.');
}
});

/* GET /api/material?material=...&run_at=... - detail materialu + potreby */
router.get('/material', async (req, res) => {
const material = (req.query.material || '').trim();
const runAt = (req.query.run_at || '').trim();

if (!material) {
return res.status(400).json({ error: 'Zadej material.' });
}

try {
const vysledek = await volatConnector('/warehouse-hladiny/material', {
query: { material, run_at: runAt },
});
res.set('Cache-Control', 'no-store');
res.json(vysledek);
} catch (err) {
chyba(res, 'GET /material', err, 'Chyba pri nacitani detailu materialu.');
}
});

/* GET /api/vyjimky - seznam vyjimek z automatickeho vypoctu */
router.get('/vyjimky', async (req, res) => {
try {
const vysledek = await volatConnector('/warehouse-hladiny/vyjimky');
res.set('Cache-Control', 'no-store');
res.json(vysledek.data || []);
} catch (err) {
chyba(res, 'GET /vyjimky', err, 'Chyba pri nacitani vyjimek.');
}
});

/* POST /api/vyjimky - zapnout/vypnout vyjimku pro material */
router.post('/vyjimky', async (req, res) => {
const material = (req.body && req.body.material || '').trim();
if (!material) return res.status(400).json({ error: 'Zadej material.' });
try {
const vysledek = await volatConnector('/warehouse-hladiny/vyjimky', {
method: 'POST',
body: {
material,
zapnuto: !!(req.body && req.body.zapnuto),
poznamka: req.body && req.body.poznamka,
uzivatel: req.body && req.body.uzivatel,
},
});
res.json(vysledek);
} catch (err) {
chyba(res, 'POST /vyjimky', err, 'Chyba pri ukladani vyjimky.');
}
});

/* POST /api/vyjimky/hromadne - hromadne nastaveni/zruseni vyjimky */
router.post('/vyjimky/hromadne', async (req, res) => {
const materials = (req.body && req.body.materials) || [];
if (!Array.isArray(materials) || !materials.length) {
return res.status(400).json({ error: 'Zadej seznam materialu.' });
}
try {
const vysledek = await volatConnector('/warehouse-hladiny/vyjimky/hromadne', {
method: 'POST',
body: {
materials,
zapnuto: !!(req.body && req.body.zapnuto),
poznamka: req.body && req.body.poznamka,
uzivatel: req.body && req.body.uzivatel,
},
});
res.json(vysledek);
} catch (err) {
chyba(res, 'POST /vyjimky/hromadne', err, 'Chyba pri hromadnem ukladani vyjimek.');
}
});

/* GET /api/zdroje - kdy naposledy dorazila zdrojova data */
router.get('/zdroje', async (req, res) => {
try {
const vysledek = await volatConnector('/warehouse-hladiny/zdroje');
res.set('Cache-Control', 'no-store');
res.json(vysledek.data || []);
} catch (err) {
chyba(res, 'GET /zdroje', err, 'Chyba pri nacitani stari zdrojovych dat.');
}
});

/* POST /api/prepocet - spusti prepocet hladin (usp_vypocet_hladin) */
router.post('/prepocet', async (req, res) => {
try {
const vysledek = await volatConnector('/warehouse-hladiny/prepocet', {
method: 'POST',
timeoutMs: 10 * 60 * 1000, // 10 minut
});
res.set('Cache-Control', 'no-store');
res.json(vysledek);
} catch (err) {
chyba(res, 'POST /prepocet', err, 'Prepocet hladin se nepodarilo dokoncit.');
}
});

module.exports = router;
