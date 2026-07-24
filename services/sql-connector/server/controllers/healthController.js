// controllers/healthController.js
// Logika pro health-check endpointy. Na rozdíl od sapIdsController
// se netýká jednoho konkrétního "zdroje dat" z databáze, ale stavu
// samotného connectoru — proto zůstává mimo /api/v1 a mimo ověření
// API klíčem (monitoring nástroje/load balancer klíč mít nemusí).

const { poolPromise } = require('../services/db');

// GET /health
// Jen potvrdí, že Express proces běží a odpovídá na požadavky.
// NEOVĚŘUJE databázi — i kdyby DB spadla, tenhle endpoint
// pořád vrátí 200. To je záměr: rozlišujeme "server žije"
// od "server je plně funkční" (viz getHealthDb níže).
function getHealth(req, res) {
  res.status(200).json({ status: 'ok' });
}

// GET /health/db
// Provede lehký, rychlý dotaz do databáze ("SELECT 1"), aby ověřil,
// že connection pool je funkční a DB skutečně odpovídá — ne jen že
// se při startu aplikace jednou úspěšně připojil.
async function getHealthDb(req, res) {
  try {
    const pool = await poolPromise;

    // "SELECT 1" je konvenční, téměř nulově nákladný dotaz používaný
    // čistě pro ověření spojení — nezajímá nás výsledek, jen to,
    // že se dotaz provedl bez chyby.
    await pool.request().query('SELECT 1 AS ok');

    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (err) {
    console.error('Health check DB selhal:', err);

    // 503 Service Unavailable — správný HTTP status pro "server běží,
    // ale závislost (databáze), na které stojí, není momentálně
    // dostupná". Monitoring nástroje na 503 typicky reagují jinak
    // než na 500 (např. to nepočítají jako bug v kódu, ale jako
    // dočasný výpadek závislosti).
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
}

module.exports = { getHealth, getHealthDb };

