/*
============================================================
API ROUTY APLIKACE AGV-UTILIZATION
============================================================
Prijme pozadavek od frontendu, zepta se sql-connectoru (ktery jediny
saha do DB) a vrati vysledek. Vse READ-ONLY (GET).

Mapovani (frontend ./api/... -> connector /api/v1/...):
GET /api/vehicles -> /agv-utilization/vehicles
GET /api/shift-numbers -> /agv-utilization/shift-numbers
(vsechny datove routy berou i &crews=1,3 = filtr cisla smeny)
GET /api/status?from&to&shift&vehicles -> /agv-utilization/status
GET /api/orders/summary?from&to&shift&... -> /agv-utilization/orders/summary
GET /api/orders?from&to&shift&vehicles&limit -> /agv-utilization/orders
*/

'use strict';

const express = require('express');

const { volatConnector } = require('../services/sql_connector-klient');

const router = express.Router();

function chyba(res, kde, err, zprava) {
console.error(`CHYBA ${kde}:`, err.message);
const status = err.statusCode || 500;
// 400 od connectoru = chyba ve filtru -> predame jeho text uzivateli.
res.status(status).json({ error: status === 400 ? err.message : zprava, detail: err.message });
}

/* Prevezme jen zname parametry filtru (nic dalsiho se do connectoru neposila). */
function filtry(q) {
return {
from: (q.from || '').trim(),
to: (q.to || '').trim(),
shift: (q.shift || '').trim(),
vehicles: (q.vehicles || '').trim(),
crews: (q.crews || '').trim(),
};
}

router.get('/vehicles', async (req, res) => {
try {
const v = await volatConnector('/agv-utilization/vehicles');
res.set('Cache-Control', 'no-store');
res.json(v.data || []);
} catch (err) {
chyba(res, 'GET /vehicles', err, 'Chyba pri nacitani seznamu AGV.');
}
});

router.get('/shift-numbers', async (req, res) => {
try {
const v = await volatConnector('/agv-utilization/shift-numbers');
res.set('Cache-Control', 'no-store');
res.json(v.data || []);
} catch (err) {
chyba(res, 'GET /shift-numbers', err, 'Chyba pri nacitani smenoveho planu.');
}
});

router.get('/status', async (req, res) => {
try {
const v = await volatConnector('/agv-utilization/status', { query: filtry(req.query) });
res.set('Cache-Control', 'no-store');
res.json(v.data || []);
} catch (err) {
chyba(res, 'GET /status', err, 'Chyba pri nacitani stavu AGV.');
}
});

router.get('/orders/summary', async (req, res) => {
try {
const v = await volatConnector('/agv-utilization/orders/summary', { query: filtry(req.query) });
res.set('Cache-Control', 'no-store');
res.json(v.data || []);
} catch (err) {
chyba(res, 'GET /orders/summary', err, 'Chyba pri nacitani souhrnu ukolu.');
}
});

router.get('/orders', async (req, res) => {
try {
const v = await volatConnector('/agv-utilization/orders', {
query: { ...filtry(req.query), limit: (req.query.limit || '').trim() },
});
res.set('Cache-Control', 'no-store');
res.json({ total: v.total || 0, limit: v.limit || null, data: v.data || [] });
} catch (err) {
chyba(res, 'GET /orders', err, 'Chyba pri nacitani ukolu.');
}
});

module.exports = router;
