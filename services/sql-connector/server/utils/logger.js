// utils/logger.js
// Centrální konfigurace loggeru pro celý connector. Místo roztroušených
// console.log/console.error voláme odsud logger.info(...) / logger.error(...)
// — všude stejný formát, stejné cíle (konzole + soubor).

const config  = require('../config');
const winston = require('winston');

const logger = winston.createLogger({
  // Úroveň logování — 'info' zaznamená info/warn/error, ale ne 'debug'.
  // V produkci by šlo přepnout na 'warn', ať se log nezaplní běžným provozem.
  level: config.LOG_LEVEL || 'info',

  // Formát: přidá timestamp ke každému záznamu a serializuje do JSON.
  // JSON formát je důležitý pro pozdější strojové zpracování logů
  // (např. import do Grafana Loki nebo ELK), ne jen pro čtení očima.
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }), // zachová stack trace u chyb
    winston.format.json()
  ),

  // Kam se logy zapisují — může jich být víc najednou ("transports").
  transports: [
    // Do souboru — jen chyby (error), pro rychlé dohledání problémů.
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    // Do souboru — úplně všechno od úrovně 'info' výš.
    new winston.transports.File({
      filename: 'logs/combined.log',
    }),
  ],
});

// V development prostředí (ne na produkčním serveru) chceme logy vidět
// i přímo v terminálu, ne jen v souborech — usnadní to ladění za běhu.
if (config.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      // Pro konzoli použijeme čitelnější, barevný formát místo JSON.
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

module.exports = logger;

