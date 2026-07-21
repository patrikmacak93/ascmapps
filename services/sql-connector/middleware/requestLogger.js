// middleware/requestLogger.js
// Middleware, který zaloguje KAŽDÝ příchozí požadavek — metodu, cestu,
// výsledný status kód a dobu trvání. Napojuje se úplně na začátek
// řetězce middlewarů v server.js, ať zachytí i požadavky, které
// později skončí na apiKeyAuth (401) nebo jinde.

const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  // Zaznamenáme čas PŘED zpracováním požadavku.
  const startTime = Date.now();

  // res.on('finish', ...) se spustí ve chvíli, kdy Express dokončil
  // odesílání odpovědi klientovi — tedy víme už i finální status kód.
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;

    logger.info('HTTP request', {
      method: req.method,       // GET, POST, ...
      path: req.originalUrl,    // /api/v1/sap-ids?prefix=E
      statusCode: res.statusCode, // 200, 401, 500, ...
      durationMs,
      ip: req.ip,                // odkud požadavek přišel
    });
  });

  // Pokračuj dál k dalšímu middlewaru / routeru.
  next();
}

module.exports = requestLogger;

