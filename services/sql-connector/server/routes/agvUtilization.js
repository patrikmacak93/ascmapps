// routes/agvUtilization.js
// URL cesty pro appku "agv-utilization". Jen smerovani - logika
// (dotazy do DB) je v controllers/agvUtilizationController.js.
// Prefix /api/v1 se prida v server.js.

const express = require('express');

const router = express.Router();

const {
getVehicles,
getShiftNumbers,
getStatus,
getOrdersSummary,
getOrders,
} = require('../controllers/agvUtilizationController');

// GET /api/v1/agv-utilization/vehicles -> seznam AGV pro filtr
router.get('/agv-utilization/vehicles', getVehicles);

// GET /api/v1/agv-utilization/shift-numbers -> cisla smen ze smenoveho planu
router.get('/agv-utilization/shift-numbers', getShiftNumbers);

// GET /api/v1/agv-utilization/status?from=&to=&shift=&vehicles=&crews= -> casy stavu
router.get('/agv-utilization/status', getStatus);

// GET /api/v1/agv-utilization/orders/summary?... -> agregace ukolu
router.get('/agv-utilization/orders/summary', getOrdersSummary);

// GET /api/v1/agv-utilization/orders?...&limit= -> jednotlive ukoly (monitor)
router.get('/agv-utilization/orders', getOrders);

module.exports = router;
