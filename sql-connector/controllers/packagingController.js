const { sql, poolPromise } = require('../db');

async function getPackaging(req, res, next) {
  try {
    const pool = await poolPromise;
    const periodType = String(req.query.period_type || '').trim();

    const request = pool.request();
    let query;

    if (periodType) {
      request.input('typObdobi', sql.NVarChar, periodType);
      query = `
        SELECT period_type, period_label, SAP_ID, local_material, Project,
               PartName, Disponent, PckPoolBalance, requirement_qty, RequiredPackagingQty
        FROM [FSTASCM].[pckForecast].[vw_APR_PackagingSAP]
        WHERE period_type = @typObdobi
        ORDER BY period_label, SAP_ID, Project, local_material`;
    } else {
      query = `
        SELECT period_type, period_label, SAP_ID, local_material, Project,
               PartName, Disponent, PckPoolBalance, requirement_qty, RequiredPackagingQty
        FROM [FSTASCM].[pckForecast].[vw_APR_PackagingSAP]
        ORDER BY period_type, period_label, SAP_ID, Project, local_material`;
    }

    const result = await request.query(query);
    res.status(200).json({ count: result.recordset.length, data: result.recordset });
  } catch (err) {
    next(err);
  }
}

module.exports = { getPackaging };
