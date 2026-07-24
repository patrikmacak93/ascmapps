// db.js
// Vytváří a spravuje připojení k SQL databázi přes Windows Trusted
// Connection (ODBC/SSPI)
//
// POZOR: narazili jsme na to, že explicitní NTLM (tedious/mssql
// s authentication.type='ntlm') je na tomto SQL Serveru/doméně
// blokované bezpečnostní politikou (NTLM Restrict). IIS appky fungují, protože automaticky vyjednávají
// Kerberos přes Windows SSPI rozhraní — msnodesqlv8 dělá totéž.
//
// DŮSLEDEK: tenhle connector MUSÍ běžet pod identitou servisního
// účtu (ne s explicitním username/password v configu) — v NSSM
// nastav "Log on as" na VT1\fsv31315 (to už máme), a Trusted_Connection
// v connection stringu použije přímo identitu procesu.

require('dotenv').config();

const config = require('../config');
// POZOR: jiný require než dřív — msnodesqlv8 varianta mssql knihovny.
const sql = require('mssql/msnodesqlv8');

// ODBC connection string — stejný formát jako shared-api.
// Trusted_Connection=Yes = použij identitu procesu (Windows SSPI),
// žádné username/password se sem nepíše.
const dbConfig = {
  connectionString:
    `Driver={${config.ODBC_DRIVER}};` +
    `Server=${config.DB_SERVER};` +
    `Database=${config.DB_DATABASE};` +
    `Trusted_Connection=Yes;` +
    `TrustServerCertificate=Yes;`,
  connectionTimeout: 15000,
  requestTimeout: 15000,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  options: {
    trustServerCertificate: true,
  },
};

// DŮLEŽITÉ (viz shared-api historie): sql.connect() musí dostat OBJEKT
// s vlastností connectionString, ne holý text — jinak ODBC Driver
// Manager neví, jaký ovladač použít.
const poolPromise = sql
  .connect(dbConfig)
  .then(pool => {
    console.log('Připojeno k SQL databázi (Trusted Connection / msnodesqlv8)');
    return pool;
  })
  .catch(err => {
    console.error('Chyba připojení k DB:', err);
    throw err;
  });

module.exports = { sql, poolPromise };

