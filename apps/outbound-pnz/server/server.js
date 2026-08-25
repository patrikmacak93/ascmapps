/*
  ============================================================
  VSTUPNI BOD BACKENDU APLIKACE OUTBOUND-PNZ
  ============================================================
  Co dela:
  1. sestavi webovy server (Express),
  2. API routy z routes/index.js napoji pod /api,
  3. staticke stranky (HTML/CSS/JS) serviruje z podslozky public/,
  4. posloucha na portu z config.js.

  Frontend vola API pres relativni "./api" (viz public/config.js),
  coz sedi na app.use("/api", ...) nize. Citlive soubory (config.js
  s API klicem, routes/, ...) jsou MIMO public/, takze se pres web
  ven nedostanou.

  Spusteni rucne:   node server.js
  V provozu:        bezi jako NSSM sluzba (node server\server.js),
                    stejne jako sql-connector a ostatni appky. IIS pouze
                    proxuje /outboundPnz/* na http://localhost:<PORT>
                    (URL Rewrite v rootovem web.config). Port a dalsi
                    hodnoty dodava NSSM pres promenne prostredi.
*/

"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");

const config = require("./config");
const apiRoutes = require("./routes");

const app = express();

// Za IIS/iisnode: at req.protocol a req.ip odpovidaji tomu, co poslal
// prohlizec, ne tomu, co vidi Node z lokalniho proxy spojeni.
app.set("trust proxy", true);

app.use(cors());
app.use(express.json());

// Zdravotni kontrola - rychle overeni, ze appka zije.
app.get("/health", (req, res) => res.json({ status: "ok" }));

// API pod /api - sedi na "./api" z public/config.js.
app.use("/api", apiRoutes);

// Staticke stranky appky (HTML/CSS/JS) z public/. Musi byt AZ za /api,
// at API routy maji prednost.
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(config.PORT, () => {
  console.log(`Outbound-PNZ backend bezi na http://localhost:${config.PORT}`);
  console.log(`sql-connector: ${config.SQL_CONNECTOR_URL}`);
});