/*
  ============================================================
  SDÍLENÉ SQL API
  ============================================================
  Co tenhle soubor dělá (celá appka je v jednom souboru, ať je
  hned vidět, jak funguje od začátku do konce):

  1. Spustí webový server (Express).
  2. Otevře spojení do SQL databáze (mssql) a znovu ho použije
     pro každý další požadavek (nezřizuje nové spojení pokaždé).
  3. Nabídne dva jednoduché endpointy:
       GET  /api/health  - rychlá kontrola, že appka běží
       POST /api/query   - spustí SQL dotaz poslaný appkou

  JAK TO POUŽÍVAJÍ JEDNOTLIVÉ APPKY (např. pck_forecast):
  Appka si SQL dotazy drží ve svém vlastním souboru (u
  pck_forecast je to server/sql-dotazy.js) - sem se posílá jen
  ten předem připravený text dotazu + konkrétní hodnoty
  (parametry). Tahle appka (shared-api) dotaz spustí v databázi
  a vrátí výsledek jako JSON.

  Příklad těla požadavku na POST /api/query:
  {
    "sql": "SELECT * FROM tabulka WHERE SAP_ID = @sapId",
    "params": { "sapId": "12345" }
  }

  DŮLEŽITÉ - proč se hodnoty posílají zvlášť jako "params", a ne
  rovnou napsané v textu dotazu: kdyby se hodnota (např. to, co
  někdo napsal do formuláře v appce) vlepila přímo do SQL textu,
  mohl by někdo poslat škodlivý text místo obyčejné hodnoty a
  poškodit/vykrást databázi (tzv. SQL injection). Když se hodnota
  pošle jako parametr (@sapId), SQL server ji vždycky bere jen
  jako "obyčejná data", nikdy jako součást příkazu - proto je
  DŮLEŽITÉ, aby appky, které tohle API volají, posílaly proměnlivé
  hodnoty vždycky přes "params", ne vlepené do "sql".
=========================================================== */

"use strict";

const express = require("express");
const cors = require("cors");
const sql = require("mssql/msnodesqlv8");
const config = require("./config");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

/* ---- Spojení do databáze - jedno sdílené pro celou appku ---- */
let poolPromise = null;

function ziskatPripojeni() {
  if (!poolPromise) {
    poolPromise = sql.connect({ connectionString: config.connectionString }).catch((err) => {
      poolPromise = null; // při chybě to appka zkusí znovu připojit příště
      throw err;
    });
  }
  return poolPromise;
}

/* ---- GET /api/health - appky/administrátor si ověří, že běží ---- */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "shared-api" });
});

/* ---- POST /api/query - spustí SQL dotaz poslaný appkou ---- */
app.post("/api/query", async (req, res) => {
  const { sql: sqlText, params } = req.body || {};

  if (!sqlText || typeof sqlText !== "string") {
    return res.status(400).json({ error: 'Chybí "sql" (text SQL dotazu) v těle požadavku.' });
  }

  try {
    const pripojeni = await ziskatPripojeni();
    const dotaz = pripojeni.request();

    // Každou hodnotu z "params" přidáme jako bezpečný parametr.
    // U hodnoty null musíme typ říct ručně (jinak mssql neví, jaký
    // typ sloupce v databázi to má být) - použijeme NVarChar, SQL
    // Server si s NULL hodnotou poradí i do číselného sloupce.
    if (params && typeof params === "object") {
      for (const [nazevParametru, hodnota] of Object.entries(params)) {
        if (hodnota === null || hodnota === undefined) {
          dotaz.input(nazevParametru, sql.NVarChar, null);
        } else {
          dotaz.input(nazevParametru, hodnota);
        }
      }
    }

    const vysledek = await dotaz.query(sqlText);

    res.json({
      rows: vysledek.recordset || [],
      rowsAffected: vysledek.rowsAffected ? vysledek.rowsAffected[0] : 0
    });
  } catch (err) {
    console.error("Chyba SQL dotazu:", err.message);
    res.status(500).json({ error: "Chyba při spuštění SQL dotazu.", detail: err.message });
  }
});

app.listen(config.PORT, () => {
  console.log(`Sdílené SQL API běží na http://localhost:${config.PORT}`);
});
