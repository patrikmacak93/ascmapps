/*
  ============================================================
  VSTUPNÍ BOD BACKENDU OBALOVÉ DATABÁZE
  ============================================================
  Nahrazuje Node-RED, který dřív běžel na
  https://fsas00025vma.vt1.vitesco.com:1884.

  Co dělá:
  1. sestaví webový server (Express),
  2. API routy z api-routes.js napojí pod /api,
  3. statické stránky (HTML/CSS/JS) servíruje z podsložky public/,
  4. poslouchá na portu z nastaveni.js.

  Statické stránky leží v public/ (pckDtbSearch.html, pck-table-search.js,
  ...) a servíruje je přímo tenhle backend přes express.static. Citlivé
  soubory (nastaveni.js s API klíčem, api-routes.js, ...) jsou o úroveň
  výš MIMO public/, takže se přes web ven nedostanou.

  Frontend volá API přes relativní "./api" (viz public/pck-config.js),
  což sedí na app.use("/api", ...) níže.

  Spuštění ručně:   node server.js
  Pod IIS:          přes iisnode, viz web.config vedle tohoto souboru
*/

"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");

const nastaveni = require("./config");
const apiRoutes = require("../routes");

const app = express();

// Za IIS/iisnode: ať req.protocol a req.ip odpovídají tomu, co poslal
// prohlížeč, ne tomu, co vidí Node z lokálního proxy spojení.
app.set("trust proxy", true);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Zdravotní kontrola — rychlé ověření, že appka žije
// (např. http://localhost:3100/health).
app.get("/health", (req, res) => res.json({ status: "ok" }));

// API pod /api — sedí na "./api" z public/pck-config.js
app.use("/api", apiRoutes);

// Statické stránky appky (HTML/CSS/JS) z public/. Musí být AŽ za /api,
// ať API routy mají přednost.
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(nastaveni.PORT, () => {
  console.log(`API obalové databáze běží na http://localhost:${nastaveni.PORT}`);
  console.log(`sql-connector: ${nastaveni.SQL_CONNECTOR_URL}`);
  console.log(`PSDS adresář:  ${nastaveni.PSDS_DIR}`);
});

