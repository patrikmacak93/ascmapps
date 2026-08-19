// controllers/pckDatabaseController.js
// Nahrazuje Node-RED flow pro obalovou databázi (tabulka dbo.pckDatabase):
//   /search_pckDtb      -> GET    /api/v1/pck-database
//   /submit-formAdd     -> POST   /api/v1/pck-database
//   /submit-formEdit    -> PUT    /api/v1/pck-database/:id
//   /submit-formDelete  -> DELETE /api/v1/pck-database/:id
//
// Zásadní rozdíl proti Node-RED: SQL dotazy se už NESKLÁDAJÍ ze stringů
// s hodnotami od uživatele. Názvy sloupců jdou z whitelistu
// (utils/pckDatabaseSloupce.js) a hodnoty jdou do dotazu výhradně
// jako pojmenované parametry (@p0, @p1, ...). Původní flow byl na SQL
// injection zranitelný — stačilo do libovolného textového pole napsat
// apostrof a dotaz se rozpadl (nebo šlo podstrčit vlastní SQL).

'use strict';

const { sql, poolPromise } = require('../services/db');
const {
  TABULKA,
  SELECT_LIST,
  pripravitPole,
} = require('../utils/pckDatabaseSloupce');

// GET /api/v1/pck-database
// Vrátí všechny záznamy s klíči přejmenovanými pro appku
// (dřív to dělal function node "Key renaming").
async function getPckDatabase(req, res, next) {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT ${SELECT_LIST}
      FROM ${TABULKA}
      ORDER BY [ID]`);

    res.status(200).json({
      count: result.recordset.length,
      data: result.recordset,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/pck-database
// Tělo = objekt s poli podle utils/pckDatabaseSloupce.js.
// Vrací ID nově vzniklého záznamu.
async function createPckRecord(req, res, next) {
  const pole = pripravitPole(req.body);

  if (pole.length === 0) {
    return res.status(400).json({ error: 'Tělo požadavku neobsahuje žádné známé pole.' });
  }

  try {
    const pool = await poolPromise;
    const request = pool.request();

    const sloupce = [];
    const parametry = [];

    pole.forEach((p, i) => {
      const nazevParametru = `p${i}`;
      sloupce.push(`[${p.db}]`);
      parametry.push(`@${nazevParametru}`);
      request.input(nazevParametru, sql.NVarChar, p.hodnota);
    });

    // POZOR: tabulka dbo.pckDatabase má trigger (dopočítává SAP ID, rozměry
    // a hmotnosti podle vybraného typu KLT/palety). SQL Server NEDOVOLÍ
    // "OUTPUT ... " vracený rovnou volajícímu, když má cílová tabulka
    // zapnutý trigger — INSERT pak spadne na chybu 334:
    //   "The target table ... cannot have any enabled triggers if the
    //    statement contains an OUTPUT clause without INTO clause."
    // (Proto zakládání záznamu padalo na HTTP 500, zatímco UPDATE, který
    // žádné OUTPUT nemá, fungoval.) Řešení: OUTPUT směřovat do tabulkové
    // proměnné (OUTPUT ... INTO), což je s triggery povolené a stále vrátí
    // skutečné nově vzniklé ID.
    const result = await request.query(`
      DECLARE @novy TABLE ([ID] INT);
      INSERT INTO ${TABULKA} (${sloupce.join(', ')})
      OUTPUT INSERTED.[ID] INTO @novy ([ID])
      VALUES (${parametry.join(', ')});
      SELECT [ID] AS ID FROM @novy;`);

    res.status(201).json({ data: { ID: result.recordset?.[0]?.ID ?? null } });
  } catch (err) {
    next(err);
  }
}

// PUT /api/v1/pck-database/:id
// Aktualizuje jen ta pole, která přišla v těle požadavku.
//
// ZMĚNA CHOVÁNÍ proti Node-RED: prázdné URL1 (PSDS) se dřív z UPDATE
// vynechávalo, takže tlačítko "Odebrat dokument" ve formuláři sice
// vypadalo, že funguje, ale odkaz v databázi zůstal. Teď se prázdná
// hodnota uloží jako NULL, tedy dokument se opravdu odebere.
async function updatePckRecord(req, res, next) {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Neplatné ID záznamu.' });
  }

  const pole = pripravitPole(req.body);

  if (pole.length === 0) {
    return res.status(400).json({ error: 'Tělo požadavku neobsahuje žádné známé pole.' });
  }

  try {
    const pool = await poolPromise;
    const request = pool.request().input('id', sql.Int, id);

    const setCasti = pole.map((p, i) => {
      const nazevParametru = `p${i}`;
      request.input(nazevParametru, sql.NVarChar, p.hodnota);
      return `[${p.db}] = @${nazevParametru}`;
    });

    const result = await request.query(`
      UPDATE ${TABULKA}
      SET ${setCasti.join(', ')}
      WHERE [ID] = @id`);

    const updatedRows = result.rowsAffected?.[0] ?? 0;

    if (updatedRows === 0) {
      return res.status(404).json({ error: `Záznam s ID ${id} neexistuje.` });
    }

    res.status(200).json({ updatedRows });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/v1/pck-database/:id
async function deletePckRecord(req, res, next) {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Neplatné ID záznamu.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM ${TABULKA} WHERE [ID] = @id`);

    const deletedRows = result.rowsAffected?.[0] ?? 0;

    if (deletedRows === 0) {
      return res.status(404).json({ error: `Záznam s ID ${id} neexistuje.` });
    }

    res.status(200).json({ deletedRows });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPckDatabase,
  createPckRecord,
  updatePckRecord,
  deletePckRecord,
};