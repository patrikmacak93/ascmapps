// controllers/outboundPnzController.js
// Logika endpointu pro vyhledani IMT odkazu podle local_material
// v tabulce outbound.pnzListSAP_zcze_sd_pn (plni ji watcher pnz_watch.py).
//
// Cesta (URL) a HTTP metoda se NEResi tady, ale v routes/outboundPnz.js.
//
// Bezpecnost: local_material prichazi od uzivatele, takze NIKDY nejde
// primo do textu dotazu - jde vyhradne jako pojmenovany parametr
// (@material). Stejny princip jako v pckDatabaseController.js. Prefix
// jmena parametru zamerne NENI "p"+cislo (koliduje s @P1 od msnodesqlv8).

'use strict';

const { sql, poolPromise } = require('../services/db');

const TABULKA = '[FSTASCM].[outbound].[pnzListSAP_zcze_sd_pn]';

// GET /api/v1/outbound-pnz?local_material=5WK1000
// Vrati vsechny radky, ktere se shoduji na local_material (jedno materialove
// cislo muze mit vic prirazenych PN = vic radku, kazdy s vlastnim imt_url).
async function getOutboundPnzByMaterial(req, res, next) {
  const localMaterial = (req.query.local_material || '').trim();

  if (!localMaterial) {
    return res.status(400).json({ error: 'Chybi parametr local_material.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool
      .request()
      .input('material', sql.NVarChar, localMaterial)
      .query(`
        SELECT record_type, local_material, assigned_pn, imt_url, loaded_at
        FROM ${TABULKA}
        WHERE local_material = @material
        ORDER BY assigned_pn`);

    res.status(200).json({
      count: result.recordset.length,
      data: result.recordset,
    });
  } catch (err) {
    // next(err) preda chybu centralizovanemu errorHandler middlewaru.
    next(err);
  }
}

module.exports = { getOutboundPnzByMaterial };