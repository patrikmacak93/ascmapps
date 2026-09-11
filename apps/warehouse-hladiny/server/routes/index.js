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

module.exports = router;
