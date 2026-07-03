// routes/sapIds.js
// Definuje, jaké URL cesty existují pro "sap-ids" a na jakou
// funkci v controlleru se každá napojuje. Tenhle soubor NEŘEŠÍ
// logiku (dotaz do DB, zpracování) — jen směrování.

const express = require('express');

// Router je "mini aplikace" — sada cest, kterou pak napojíme
// do hlavní app v server.js.
const router = express.Router();

const { getSapIds } = require('../controllers/sapIdsController');

// GET /api/v1/sap-ids  (prefix /api/v1 se přidá až v server.js)
router.get('/sap-ids', getSapIds);

// Až přibudou další cesty pro sap-ids (např. detail podle ID),
// přidají se sem stejným způsobem:
// router.get('/sap-ids/:id', getSapIdById);

module.exports = router;

