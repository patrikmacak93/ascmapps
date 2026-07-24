// middleware/apiKeyAuth.js
// Middleware = funkce, která se spustí PŘED handlerem v controlleru,
// pro KAŽDÝ požadavek, na který je napojená. Typicky slouží k věcem,
// co se mají provést opakovaně napříč endpointy — tady: ověření,
// že požadavek nese platný API klíč.
//
// Pokud middleware zavolá next(), Express pokračuje dál (k dalšímu
// middlewaru nebo rovnou k handleru v controlleru).
// Pokud middleware sám pošle odpověď (res.status(...).json(...)),
// řetězec se tam zastaví — handler v controlleru se už nezavolá.
const config = require('../config');

function apiKeyAuth(req, res, next) {
    // Klient posílá klíč v hlavičce "x-api-key".
    // Hlavičky Express automaticky převádí na malá písmena,
    // takže req.headers['x-api-key'] funguje bez ohledu na to,
    // jak přesně klient hlavičku napsal (X-API-KEY, x-api-key...).
    const providedKey = req.headers['x-api-key'];
  
    // Očekávaný klíč načtený z .env (nikdy napevno v kódu).
    const expectedKey = config.API_KEY;
  
    // Pokud connector vůbec nemá API_KEY nastavený v .env,
    // je to chyba konfigurace serveru, ne klienta — nechceme,
    // aby endpoint byl omylem otevřený všem jen proto, že
    // administrátor zapomněl klíč nastavit.
    if (!expectedKey) {
      console.error('API_KEY není nastaven v .env — endpoint je needed zabezpečit.');
      return res.status(500).json({ error: 'Interní chyba konfigurace serveru' });
    }
  
    // Klíč chybí úplně.
    if (!providedKey) {
      return res.status(401).json({ error: 'Chybí API klíč (hlavička x-api-key)' });
    }
  
    // Klíč je přítomný, ale nesedí.
    if (providedKey !== expectedKey) {
      return res.status(401).json({ error: 'Neplatný API klíč' });
    }
  
    // Klíč sedí — pokračuj dál k dalšímu middlewaru / handleru.
    next();
  }
  
  module.exports = apiKeyAuth;
  
  