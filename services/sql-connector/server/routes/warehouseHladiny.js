// routes/warehouseHladiny.js
// Definuje URL cesty pro "warehouse-hladiny" a napojuje je na funkce
// v controlleru. Tenhle soubor NERESI logiku (dotaz do DB) - jen smerovani.
// Prefix /api/v1 se prida v server.js.

const express = require('express');

const router = express.Router();

const {
getRuns,
getVypocet,
getSummary,
getMaterialDetail,
getVyjimky,
setVyjimka,
} = require('../controllers/warehouseHladinyController');

// GET /api/v1/warehouse-hladiny/runs -> seznam behu vypoctu
router.get('/warehouse-hladiny/runs', getRuns);

// GET /api/v1/warehouse-hladiny/vypocet?run_at=... -> radky behu (tabulka)
router.get('/warehouse-hladiny/vypocet', getVypocet);

// GET /api/v1/warehouse-hladiny/summary?run_at=... -> agregace po duvodech
router.get('/warehouse-hladiny/summary', getSummary);

// GET /api/v1/warehouse-hladiny/material?material=...&run_at=... -> detail + potreby
router.get('/warehouse-hladiny/material', getMaterialDetail);

// GET /api/v1/warehouse-hladiny/vyjimky -> seznam vyjimek
router.get('/warehouse-hladiny/vyjimky', getVyjimky);

// POST /api/v1/warehouse-hladiny/vyjimky -> zapnout/vypnout vyjimku
router.post('/warehouse-hladiny/vyjimky', setVyjimka);

module.exports = router;
