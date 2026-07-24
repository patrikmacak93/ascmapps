// routes/auth.js
// Přihlášení uživatelů (tabulka eBoard_users). Prefix /api/v1 se přidává
// až v server.js -> výsledná cesta je POST /api/v1/login.

'use strict';

const express = require('express');
const router = express.Router();

const { login } = require('../controllers/authController');

router.post('/login', login);

module.exports = router;

