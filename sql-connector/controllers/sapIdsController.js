// controllers/sapIdsController.js
// Logika endpointu(ů) pro SAP_ID. "Controller" = funkce, která dostane
// req (požadavek) a res (odpověď) a rozhodne, co se má stát —
// tady: zeptat se databáze a vrátit JSON.
//
// Cesta (URL) a HTTP metoda se NEŘEŠÍ tady, ale v routes/sapIds.js.
// Tenhle soubor neví a nemusí vědět, na jaké přesně URL visí.

const { sql, poolPromise } = require('../db');

// GET /api/v1/sap-ids
// Vrátí pole unikátních SAP_ID z view pckForecast.vw_APR_PackagingSAP.
async function getSapIds(req, res, next) {
  try {
    const pool = await poolPromise;

    const result = await pool
      .request()
      .query('SELECT DISTINCT SAP_ID FROM pckForecast.vw_APR_PackagingSAP');

    const sapIds = result.recordset.map(row => row.SAP_ID);

    res.status(200).json({
      count: sapIds.length,
      data: sapIds,
    });
  } catch (err) {
    // next(err) předá chybu centralizovanému errorHandler middlewaru
    // (middleware/errorHandler.js) místo toho, abychom tady ručně
    // volali console.error a res.status(500)... — logika je teď
    // na jednom místě pro všechny endpointy, ne opakovaná v každém.
    next(err);
  }
}

// Exportujeme jako objekt — až přibudou další funkce
// (např. getSapIdById), přidáme je sem vedle.
module.exports = { getSapIds };

