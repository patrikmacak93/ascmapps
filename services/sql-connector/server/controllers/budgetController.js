// budgetController.js
// Načte celý obsah view [FSTASCM].[pckForecast].[vw_budget].
// Stejný vzor jako packagingController.js — vrací { count, data }.

const { poolPromise } = require('../services/db');

async function getBudget(req, res, next) {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT * FROM [FSTASCM].[pckForecast].[vw_budget]`);

    res.status(200).json({ count: result.recordset.length, data: result.recordset });
  } catch (err) {
    next(err);
  }
}

module.exports = { getBudget };
