const { sql, poolPromise } = require('../services/db');

const EDITOVATELNA_POLE = {
  SAP_ID: 'SAP ID',
  Project: 'Projekt',
  Loop: 'Loop',
  Loop_simulace: 'Loop simulace',
  Nakoupeno: 'Nakoupeno',
  Disponent: 'Disponent',
  Cena_za_ks: 'Cena za ks',
  Pro_budget_budeme_dokupovat: 'Pro budget budeme dokupovat',
};

const CISELNA_POLE = new Set([
  'Loop', 'Loop_simulace', 'Nakoupeno', 'Cena_za_ks', 'Pro_budget_budeme_dokupovat',
]);

function pridatParam(request, nazev, hodnota) {
  if (hodnota === null || hodnota === undefined) {
    request.input(nazev, sql.NVarChar, null);
  } else {
    request.input(nazev, hodnota);
  }
}

async function getEmpties(req, res, next) {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT EmptiesID, [SAP ID] AS SAP_ID, Projekt AS Project, Loop,
             [Loop simulace] AS Loop_simulace, Nakoupeno, Disponent,
             [Cena za ks] AS Cena_za_ks,
             [Pro budget budeme dokupovat] AS Pro_budget_budeme_dokupovat
      FROM [FSTASCM].[pckForecast].[Empties]
      ORDER BY EmptiesID`);

    res.status(200).json({ count: result.recordset.length, data: result.recordset });
  } catch (err) {
    next(err);
  }
}

async function createEmpty(req, res, next) {
  const cislo = v => (v === '' || v === null || v === undefined ? null : Number(v));
  const b = req.body || {};

  try {
    const pool = await poolPromise;
    const request = pool.request();

    pridatParam(request, 'SAP_ID', b.SAP_ID ?? null);
    pridatParam(request, 'Project', b.Project ?? null);
    pridatParam(request, 'Loop', cislo(b.Loop));
    pridatParam(request, 'Loop_simulace', cislo(b.Loop_simulace));
    pridatParam(request, 'Nakoupeno', cislo(b.Nakoupeno));
    pridatParam(request, 'Disponent', b.Disponent ?? null);
    pridatParam(request, 'Cena_za_ks', cislo(b.Cena_za_ks));
    pridatParam(request, 'Pro_budget_budeme_dokupovat', cislo(b.Pro_budget_budeme_dokupovat));

    const result = await request.query(`
      INSERT INTO [FSTASCM].[pckForecast].[Empties]
        ([SAP ID], Projekt, Loop, [Loop simulace], Nakoupeno, Disponent,
         [Cena za ks], [Pro budget budeme dokupovat])
      OUTPUT INSERTED.EmptiesID AS EmptiesID
      VALUES (@SAP_ID, @Project, @Loop, @Loop_simulace, @Nakoupeno, @Disponent,
              @Cena_za_ks, @Pro_budget_budeme_dokupovat)`);

    res.status(201).json({ data: { EmptiesID: result.recordset?.[0]?.EmptiesID ?? null } });
  } catch (err) {
    next(err);
  }
}

async function updateEmpty(req, res, next) {
  const id = Number(req.params.id);
  const { field, value } = req.body || {};
  const sloupec = EDITOVATELNA_POLE[field];

  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Neplatné EmptiesID.' });
  if (!sloupec) return res.status(400).json({ error: 'Neplatné pole pro update.' });

  let hodnota = value;
  if (CISELNA_POLE.has(field)) {
    hodnota = value === null || value === '' ? null : Number(value);
    if (!Number.isFinite(hodnota)) hodnota = null;
  } else {
    hodnota = value === null || value === undefined ? null : String(value);
  }

  try {
    const pool = await poolPromise;
    const request = pool.request().input('id', sql.Int, id);
    pridatParam(request, 'hodnota', hodnota);

    const result = await request.query(
      `UPDATE [FSTASCM].[pckForecast].[Empties] SET [${sloupec}] = @hodnota WHERE EmptiesID = @id`
    );

    res.status(200).json({ updatedRows: result.rowsAffected?.[0] ?? 0 });
  } catch (err) {
    next(err);
  }
}

module.exports = { getEmpties, createEmpty, updateEmpty };
