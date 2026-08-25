/*
  ============================================================
  API ROUTY APLIKACE OUTBOUND-PNZ
  ============================================================
  Jedina uloha tohoto backendu: prijmout od frontendu local_material,
  zeptat se sql-connectoru a vratit vysledek (vcetne imt_url). Sam se
  do databaze nepripojuje - to dela vyhradne sql-connector (pres
  sql_connector-klient.js, ktery pridava API klic).

  Mapovani:
    GET /api/outbound-pnz?local_material=...
        -> GET /api/v1/outbound-pnz?local_material=...  (na connectoru)
*/

"use strict";

const express = require("express");

const { volatConnector } = require("../services/sql_connector-klient");

const router = express.Router();

/** Sjednocene odeslani chyby klientovi + zapis do logu serveru. */
function chyba(res, kde, err, zprava) {
  console.error(`CHYBA ${kde}:`, err.message);
  res.status(err.statusCode || 500).json({ error: zprava, detail: err.message });
}

/* ===========================================================
   GET /outbound-pnz?local_material=...
   -----------------------------------------------------------
   Vrati pole radku pro dane materialove cislo. Kazdy radek nese
   prirazene PN (assigned_pn) a hotovy odkaz do IMT (imt_url).
   Obalku { count, data } od connectoru tady rozbalime a vratime
   rovnou pole - to ceka frontend.
=========================================================== */
router.get("/outbound-pnz", async (req, res) => {
  const localMaterial = (req.query.local_material || "").trim();

  if (!localMaterial) {
    return res.status(400).json({ error: "Zadej local_material." });
  }

  try {
    const vysledek = await volatConnector("/outbound-pnz", {
      query: { local_material: localMaterial },
    });

    res.set("Cache-Control", "no-store");
    res.json(vysledek.data || []);
  } catch (err) {
    chyba(res, "GET /outbound-pnz", err, "Chyba pri vyhledavani v outbound PNZ.");
  }
});

module.exports = router;