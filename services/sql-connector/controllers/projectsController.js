const { poolPromise } = require('../db');

async function getProjects(req, res, next) {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT DISTINCT Project
      FROM [FSTASCM].[pckForecast].[vw_APR_PackagingSAP]
      WHERE Project IS NOT NULL AND Project <> ''
      ORDER BY Project`);

    const projects = result.recordset.map(r => r.Project);
    res.status(200).json({ count: projects.length, data: projects });
  } catch (err) {
    next(err);
  }
}

module.exports = { getProjects };
