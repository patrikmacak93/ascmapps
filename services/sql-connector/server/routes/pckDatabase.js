// routes/pckDatabase.js
// Cesty pro obalovou databázi (tabulka dbo.pckDatabase). Prefix /api/v1
// se přidává až v server.js.

'use strict';

const express = require('express');
const router = express.Router();

const {
  getPckDatabase,
  createPckRecord,
  updatePckRecord,
  deletePckRecord,
} = require('../controllers/pckDatabaseController');

router.get('/pck-database', getPckDatabase);
router.post('/pck-database', createPckRecord);
router.put('/pck-database/:id', updatePckRecord);
router.delete('/pck-database/:id', deletePckRecord);

module.exports = router;

