const { sql, poolPromise } = require('../db');

async function getParetoPotreba(req, res, next) {
  try {
    const pool = await poolPromise;
    const obdobi = String(req.query.period || '').trim() || null;

    const result = await pool.request()
      .input('obdobi', sql.NVarChar, obdobi)
      .query(`
        SELECT SAP_ID, SUM(RequiredPackagingQty) AS RequiredPackagingQty
        FROM [FSTASCM].[pckForecast].[vw_APR_PackagingSAP]
        WHERE period_type = 'month'
          AND (@obdobi IS NULL OR period_label = @obdobi)
        GROUP BY SAP_ID
        ORDER BY SUM(RequiredPackagingQty) DESC`);

    res.status(200).json({ count: result.recordset.length, data: result.recordset });
  } catch (err) {
    next(err);
  }
}

async function getParetoNakoupeno(req, res, next) {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT [SAP ID] AS SAP_ID, SUM(Nakoupeno) AS Nakoupeno
      FROM [FSTASCM].[pckForecast].[Empties]
      WHERE [SAP ID] IS NOT NULL AND [SAP ID] <> ''
      GROUP BY [SAP ID]`);

    res.status(200).json({ count: result.recordset.length, data: result.recordset });
  } catch (err) {
    next(err);
  }
}

module.exports = { getParetoPotreba, getParetoNakoupeno };
