// middleware/errorHandler.js
// Centralizovaný error handler. Express speciálně rozpozná middleware
// se 4 parametry (err, req, res, next) jako "error handler" a zavolá
// ho automaticky, kdykoliv:
//   a) handler v controlleru zavolá next(err) místo res.status(...).json(...)
//   b) v async funkci vznikne neodchycená výjimka (s Express 5 / správným
//      wrapperem se propaguje sem místo pádu celého procesu)
//
// Musí být zaregistrovaný v server.js JAKO POSLEDNÍ middleware —
// Express error handlery volá jen tehdy, když je zjevně pozná podle
// počtu parametrů A podle toho, že jsou registrované AŽ PO routerech.

const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  // Zalogujeme chybu se vším podstatným pro debugging — na serveru,
  // ne klientovi.
  logger.error('Neošetřená chyba', {
    message: err.message,
    stack: err.stack,
    method: req.method,
    path: req.originalUrl,
  });

  // Klientovi NIKDY neposíláme err.message nebo err.stack — mohly by
  // prozradit strukturu databáze, cesty na serveru apod. Stejný princip,
  // jaký jsme používali v controllerech od začátku.
  res.status(500).json({ error: 'Interní chyba serveru' });
}

module.exports = errorHandler;

