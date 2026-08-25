// routes/outboundPnz.js
// Definuje URL cesty pro "outbound-pnz" a napojuje je na funkce
// v controlleru. Tenhle soubor NERESI logiku (dotaz do DB) - jen smerovani.

const express = require('express');

const router = express.Router();

const { getOutboundPnzByMaterial } = require('../controllers/outboundPnzController');

// GET /api/v1/outbound-pnz?local_material=...  (prefix /api/v1 se prida v server.js)
router.get('/outbound-pnz', getOutboundPnzByMaterial);

module.exports = router;