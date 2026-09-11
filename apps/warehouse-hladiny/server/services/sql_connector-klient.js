/*
============================================================
KLIENT PRO SQL-CONNECTOR
============================================================
Jedna funkce (volatConnector), kterou pouzivaji vsechny routy
v routes/index.js. Prida k pozadavku API klic, posle ho na
sql-connector a vrati rozparsovane telo odpovedi.

Tenhle backend SAM neotevira spojeni do databaze - o to se
stara vyhradne sql-connector. Stejny soubor (jen bez komentaru
navic) pouziva i outbound-pnz a pck_forecast.

Vyzaduje Node.js 18+ (kvuli vestavenemu fetch).
*/

'use strict';

const { SQL_CONNECTOR_URL, SQL_CONNECTOR_API_KEY } = require('../config');

async function volatConnector(cesta, { method = 'GET', query, body } = {}) {
let url = `${SQL_CONNECTOR_URL}${cesta}`;

if (query) {
const qs = new URLSearchParams();
for (const [klic, hodnota] of Object.entries(query)) {
if (hodnota !== undefined && hodnota !== null && hodnota !== '') {
qs.append(klic, hodnota);
}
}
const s = qs.toString();
if (s) url += `?${s}`;
}

let odpoved;
try {
odpoved = await fetch(url, {
method,
headers: {
'Content-Type': 'application/json',
'x-api-key': SQL_CONNECTOR_API_KEY,
},
body: body ? JSON.stringify(body) : undefined,
});
} catch (err) {
const detail = err.cause && err.cause.message ? err.cause.message : err.message;
const chyba = new Error(
`Nepodarilo se spojit se sql-connectorem (${SQL_CONNECTOR_URL}): ${detail}`
);
chyba.statusCode = 502;
throw chyba;
}

const telo = await odpoved.json().catch(() => ({}));

if (!odpoved.ok) {
const chyba = new Error(telo.error || `sql-connector vratil chybu HTTP ${odpoved.status}`);
chyba.statusCode = odpoved.status;
throw chyba;
}

return telo;
}

module.exports = { volatConnector };
