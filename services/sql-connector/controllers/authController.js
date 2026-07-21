// controllers/authController.js
// Nahrazuje Node-RED endpoint /login (tabulka dbo.eBoard_users).
//
// BEZPEČNOSTNÍ POZNÁMKA — přečti si to, než to pustíš do provozu:
//
// 1) Původní Node-RED dotaz vkládal jméno a heslo přímo do textu SQL:
//        WHERE Username = '${user}' AND PasswordHash = '${pass}'
//    To znamenalo, že kdokoliv mohl do políčka heslo napsat
//        ' OR '1'='1
//    a přihlásit se jako první uživatel v tabulce, bez znalosti hesla.
//    Tady už jsou obě hodnoty poslané jako parametry (@username, @password),
//    takže se s nimi zachází jako s daty, nikdy jako s kódem.
//
// 2) Sloupec se jmenuje PasswordHash, ale porovnává se s heslem, které
//    přijde z formuláře v otevřené podobě — hesla tedy v databázi zjevně
//    hashovaná NEJSOU. Tenhle endpoint to chování zachovává, aby se
//    stávající účty nerozbily, ale je to věc, kterou by bylo dobré
//    dořešit (bcrypt/argon2 + porovnání hashů na serveru).
//
// 3) Přihlášení je pořád jen "brána" v prohlížeči — stav se ukládá do
//    localStorage a API samo o uživateli nic neví. Kdo zná adresu
//    connectoru a API klíč, data přečte i bez loginu. Skutečné zabezpečení
//    by znamenalo vydávat token (JWT — knihovna už je v package.json)
//    a ověřovat ho u zapisujících endpointů.

'use strict';

const { sql, poolPromise } = require('../db');

const TABULKA_UZIVATELE = '[FSTASCM].[dbo].[eBoard_users]';

// POST /api/v1/login   { username, password }
// Odpověď (stejný tvar, jaký čekal frontend od Node-RED):
//   { success: true,  message: "Login successful", accesses: [...] }
//   { success: false, message: "Invalid username or password" }
//
// Neplatné přihlášení vrací HTTP 200 se success:false (ne 401) — frontend
// (pck-auth.js) rozlišuje chybu serveru od špatného hesla právě takhle.
async function login(req, res, next) {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Chybí uživatelské jméno nebo heslo.',
    });
  }

  try {
    const pool = await poolPromise;

    const result = await pool
      .request()
      .input('username', sql.NVarChar, username)
      .input('password', sql.NVarChar, password)
      .query(`
        SELECT TOP 1 UserID, Username, AccessesJSON
        FROM ${TABULKA_UZIVATELE}
        WHERE Username = @username AND PasswordHash = @password`);

    const uzivatel = result.recordset?.[0];

    if (!uzivatel) {
      return res.status(200).json({
        success: false,
        message: 'Invalid username or password',
      });
    }

    // AccessesJSON je v DB uložený jako text s JSON polem, např. ["pckDtbEdit"].
    // Když je prázdný nebo poškozený, radši prázdný seznam než pád endpointu.
    let accesses = [];
    try {
      const parsed = JSON.parse(uzivatel.AccessesJSON || '[]');
      if (Array.isArray(parsed)) accesses = parsed;
    } catch (err) {
      accesses = [];
    }

    res.status(200).json({
      success: true,
      message: 'Login successful',
      username: uzivatel.Username,
      accesses,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { login };

