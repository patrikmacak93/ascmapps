/*
============================================================
VSTUPNI BOD BACKENDU APLIKACE AGV-UTILIZATION
============================================================
1. sestavi webovy server (Express),
2. API routy z routes/index.js napoji pod /api,
3. staticke stranky (HTML/CSS/JS) serviruje z public/,
4. posloucha na portu z config.js.

Spusteni rucne: node server/server.js
V provozu: NSSM sluzba, IIS proxuje /agvUtilization/* na
http://localhost:<PORT> (URL Rewrite v rootovem web.config).
*/

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const apiRoutes = require('./routes');

const app = express();

app.set('trust proxy', true);

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', apiRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(config.PORT, () => {
console.log(`AGV-utilization backend bezi na http://localhost:${config.PORT}`);
console.log(`sql-connector: ${config.SQL_CONNECTOR_URL}`);
});
