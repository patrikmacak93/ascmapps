const { poolPromise } = require('../db.js');

async function getAgvList(req, res, next) {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(
      'SELECT VehicleNumber FROM [FSTASCM].[dbo].[agvList];'
    );

    const vehicleNumbers = result.recordset.map(row => row.VehicleNumber);

    res.json(vehicleNumbers);
  } catch (err) {
    next(err);
  }
}

module.exports = getAgvList;