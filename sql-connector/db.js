// db.js
// Vytváří a spravuje připojení k SQL databázi přes Windows (NTLM) autentizaci.
// Ostatní soubory (endpointy, testy) si odtud berou sdílený connection pool.

// Načte soubor .env a jeho obsah vloží do process.env.
// MUSÍ být na úplně prvním řádku — jinak by proměnné jako DB_SERVER
// nebyly ještě dostupné, když je kód níže potřebuje.
require('dotenv').config();

// Načte knihovnu mssql, která umí mluvit se SQL Serverem
// (pod kapotou používá tedious). Modul "sql" exportujeme na konci,
// aby ho mohly používat i další soubory (např. při psaní dotazů).
const sql = require('mssql');
const logger = require('./utils/logger');

const config = {
  // Název SQL serveru. U named instance (server\instance) jde
  // celý řetězec včetně zpětného lomítka.
  server: process.env.DB_SERVER,

  // Konkrétní databáze, ke které se připojujeme.
  database: process.env.DB_DATABASE,

  // Tohle je JAK se ověříme (autentizace).
  authentication: {
    // 'ntlm' = použij Windows autentizaci přes NTLM protokol
    // místo klasického SQL loginu (uživatel/heslo přímo v DB).
    type: 'ntlm',
    options: {
      // POZOR: klíče musí být přesně domain / userName / password —
      // to je pevně daný tvar, který očekává knihovna tedious pod mssql.
      // (Tady jsme dřív měli bug: překlep DBPASSWORD místo DB_PASSWORD.)
      domain: process.env.DB_DOMAIN,
      userName: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    },
  },

  // Tohle je DRUHÝ, jiný "options" objekt — netýká se autentizace,
  // ale obecného chování spojení. Snadno se plete s authentication.options.
  options: {
    // Zapne šifrování TDS provozu mezi connectorem a databází.
    encrypt: true,
    // true = nekontroluj platnost SSL certifikátu serveru.
    // OK pro vývoj/interní síť; v produkci s platným certifikátem dej false.
    trustServerCertificate: true,
  },

  // Nastavení connection poolu — místo otevírání nového spojení
  // pro každý požadavek (pomalé, drahé) mssql udržuje sadu
  // otevřených spojení a půjčuje je.
  pool: {
    max: 10,               // nejvíc 10 současných spojení
    min: 0,                // klidně žádné, když nic neběží
    idleTimeoutMillis: 30000, // nečinné spojení se zavře po 30 s
  },
};

// Tady se pool skutečně VYTVOŘÍ a PŘIPOJÍ — hned při startu aplikace,
// ne až při prvním požadavku.
// poolPromise je Promise: buď se vyřeší na pool objekt (úspěch),
// nebo skončí chybou, kterou zalogujeme a znovu vyhodíme (throw err),
// aby si ji mohl odchytit i kód, který db.js importuje jinde.
const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    logger.info('Připojeno k SQL databázi');
    return pool;
  })
  .catch(err => {
    logger.error('Chyba připojení k DB', { message: err.message, stack: err.stack });
    throw err;
  });

// Zpřístupní sql (knihovnu) a poolPromise (připojení) ostatním
// souborům přes require('./db').
module.exports = { sql, poolPromise };

