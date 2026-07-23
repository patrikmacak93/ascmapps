/*
  ============================================================
  VSTUPNÍ BOD APPKY
  ============================================================
  Tenhle soubor appku spouští. Nedělá skoro nic sám - jen:
  1. sestaví webový server (Express),
  2. napojí na něj všechny routy z server/api-routes.js,
  3. servíruje statické soubory appky (HTML/CSS/JS z public/),
  4. spustí naslouchání na portu z server/nastaveni.js.

  Když appku spouštíš, spouštíš vlastně tenhle soubor:
    node server.js
=========================================================== */

"use strict";

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const path = require("path");

const nastaveni = require("./config");
const apiRoutes = require("./routes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(compression());

// Vše, co appka nabízí prohlížeči (viz server/api-routes.js), je
// dostupné pod adresou /api/...
app.use("/api", apiRoutes);

// Statické soubory appky (HTML/CSS/JS) - viz public/index.html
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(nastaveni.PORT, () => {
  console.log(`API běží na http://localhost:${nastaveni.PORT}`);
});
