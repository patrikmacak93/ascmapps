/*
  ============================================================
  API ROUTY OBALOVÉ DATABÁZE
  ============================================================
  Tohle je 1:1 náhrada Node-RED flow z portu 1884. Mapování starých
  endpointů na nové:

    POST /login              -> POST   /login              (beze změny)
    GET  /search_pckDtb      -> GET    /pck-database
    POST /submit-formAdd     -> POST   /pck-database
    POST /submit-formEdit    -> PUT    /pck-database/:id
    POST /submit-formDelete  -> DELETE /pck-database/:id
    POST /upload-psds        -> POST   /psds
    (Node-RED servíroval i samotné soubory) -> GET /psds/:soubor

  Databázové operace se posílají na sql-connector (přes
  sql_connector-klient.js). Práce se soubory (PSDS) zůstává tady —
  do connectoru nepatří, ten mluví jen s databází.
*/

"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const config = require("../config");
const { volatConnector } = require("../services/sql_connector-klient");

const router = express.Router();

/* ===========================================================
   Pomocné funkce
=========================================================== */

/** Sjednocené odeslání chyby klientovi + zápis do logu serveru. */
function chyba(res, kde, err, zprava) {
  console.error(`CHYBA ${kde}:`, err.message);
  res.status(err.statusCode || 500).json({ error: zprava, detail: err.message });
}

/* ===========================================================
   POST /login
   -----------------------------------------------------------
   Frontend (pck-auth.js) čeká { success, message, accesses }.
   Neplatné heslo = HTTP 200 se success:false, ne 401 — jinak by
   uživatel viděl "Server odpověděl chybou 401" místo "Nesprávné
   jméno nebo heslo".
=========================================================== */
router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};

  try {
    const vysledek = await volatConnector("/login", {
      method: "POST",
      body: { username, password },
    });

    res.json(vysledek);
  } catch (err) {
    chyba(res, "POST /login", err, "Přihlášení se nezdařilo.");
  }
});

/* ===========================================================
   GET /pck-database  (dřív GET /search_pckDtb)
   -----------------------------------------------------------
   Vrací rovnou POLE řádků — přesně to, co Node-RED vracel dřív
   a co čeká pck-table-search.js. Obálku { count, data } od
   connectoru tady rozbalíme.
=========================================================== */
router.get("/pck-database", async (req, res) => {
  try {
    const vysledek = await volatConnector("/pck-database");
    res.set("Cache-Control", "no-store");
    res.json(vysledek.data);
  } catch (err) {
    chyba(res, "GET /pck-database", err, "Chyba při načítání obalové databáze.");
  }
});

/* ===========================================================
   POST /pck-database  (dřív POST /submit-formAdd)
=========================================================== */
router.post("/pck-database", async (req, res) => {
  try {
    const vysledek = await volatConnector("/pck-database", {
      method: "POST",
      body: req.body || {},
    });

    res.status(201).json({ ok: true, ID: vysledek.data?.ID ?? null });
  } catch (err) {
    chyba(res, "POST /pck-database", err, "Chyba při zakládání záznamu.");
  }
});

/* ===========================================================
   PUT /pck-database/:id  (dřív POST /submit-formEdit)
=========================================================== */
router.put("/pck-database/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Neplatné ID záznamu." });
  }

  // ID posílá formulář i v těle; pro jistotu ho odsud odstraníme,
  // ať se nikdo nepokouší přepsat primární klíč.
  const telo = { ...(req.body || {}) };
  delete telo.ID;

  try {
    const vysledek = await volatConnector(`/pck-database/${id}`, {
      method: "PUT",
      body: telo,
    });

    res.json({ ok: true, updatedRows: vysledek.updatedRows ?? 0 });
  } catch (err) {
    chyba(res, "PUT /pck-database/:id", err, "Chyba při ukládání změn.");
  }
});

/* ===========================================================
   DELETE /pck-database/:id  (dřív POST /submit-formDelete)
=========================================================== */
router.delete("/pck-database/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Neplatné ID záznamu." });
  }

  try {
    const vysledek = await volatConnector(`/pck-database/${id}`, { method: "DELETE" });
    res.json({ ok: true, deletedRows: vysledek.deletedRows ?? 0 });
  } catch (err) {
    chyba(res, "DELETE /pck-database/:id", err, "Chyba při mazání záznamu.");
  }
});

/* ===========================================================
   POST /psds  (dřív POST /upload-psds)
   -----------------------------------------------------------
   Uloží nahraný soubor do config.PSDS_DIR a vrátí { url }.
   Tu URL si formulář schová do skrytého pole URL1 a uloží ji
   se záznamem — do databáze se tedy ukládá jen odkaz, ne soubor.
=========================================================== */

/** Z názvu souboru udělá bezpečný název: bez cest, bez divných znaků. */
function bezpecnyNazev(puvodni) {
  const zaklad = path.basename(puvodni || "soubor");
  const pripona = path.extname(zaklad).toLowerCase();
  const jmeno = path.basename(zaklad, path.extname(zaklad));

  const ocistene = jmeno
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")   // diakritika pryč
    .replace(/[^a-zA-Z0-9._-]+/g, "_") // vše ostatní na podtržítko
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  return (ocistene || "soubor") + pripona;
}

const uloziste = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdir(config.PSDS_DIR, { recursive: true }, (err) => cb(err, config.PSDS_DIR));
  },
  filename(req, file, cb) {
    let nazev = bezpecnyNazev(file.originalname);

    // Node-RED soubor se stejným jménem přepisoval — což tiše zabilo
    // PSDS jiného záznamu, pokud dva lidi nahráli soubor stejného jména.
    // Při kolizi proto přidáme časové razítko.
    if (fs.existsSync(path.join(config.PSDS_DIR, nazev))) {
      const pripona = path.extname(nazev);
      const jmeno = path.basename(nazev, pripona);
      nazev = `${jmeno}_${Date.now()}${pripona}`;
    }

    cb(null, nazev);
  },
});

const upload = multer({
  storage: uloziste,
  limits: { fileSize: config.PSDS_MAX_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    const pripona = path.extname(file.originalname || "").toLowerCase();
    if (!config.PSDS_POVOLENE_PRIPONY.includes(pripona)) {
      return cb(new Error(`Nepovolený typ souboru (${pripona || "bez přípony"}).`));
    }
    cb(null, true);
  },
});

/**
 * Veřejná adresa souboru — jen když je v nastavení PSDS_PUBLIC_BASE.
 *
 * Proč ne "odvodit z požadavku": pod IIS běží tenhle backend jako aplikace
 * ve virtuální cestě (…/PackagingDatabase/api), ale Express o tom prefixu
 * neví — req.baseUrl je prázdný. Adresa složená ze serveru by tak vyšla
 * bez prefixu a odkaz v databázi by nefungoval. Když PSDS_PUBLIC_BASE není
 * nastavená, vrátíme jen název souboru a absolutní adresu si složí prohlížeč
 * (pck-edit-form.js), který svou vlastní adresu zná spolehlivě.
 */
function verejnaUrl(nazevSouboru) {
  if (!config.PSDS_PUBLIC_BASE) return null;

  const zaklad = config.PSDS_PUBLIC_BASE.replace(/\/+$/, "");
  return `${zaklad}/${encodeURIComponent(nazevSouboru)}`;
}

router.post("/psds", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      console.error("CHYBA POST /psds:", err.message);
      return res.status(400).json({ error: "Soubor se nepodařilo nahrát.", detail: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Požadavek neobsahuje žádný soubor." });
    }

    // filename posíláme vždy, url jen když je nakonfigurovaná pevná základna.
    res.json({ filename: req.file.filename, url: verejnaUrl(req.file.filename) });
  });
});

/* ===========================================================
   GET /psds/:soubor
   -----------------------------------------------------------
   Servíruje nahrané PSDS soubory z disku (tohle dělal dřív
   Node-RED na portu 1884). Bez tohohle by odkazy v tabulce
   po vypnutí Node-RED přestaly fungovat.
=========================================================== */
router.get("/psds/:soubor", (req, res) => {
  // path.basename zahodí jakékoliv "../" — jinak by šlo přes odkaz
  // sáhnout kamkoliv na disk serveru.
  const nazev = path.basename(req.params.soubor);
  const cesta = path.join(config.PSDS_DIR, nazev);

  // Druhá pojistka: výsledná cesta musí opravdu ležet v PSDS_DIR.
  if (!path.resolve(cesta).startsWith(path.resolve(config.PSDS_DIR))) {
    return res.status(400).json({ error: "Neplatný název souboru." });
  }

  res.sendFile(cesta, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: "Soubor nenalezen." });
    }
  });
});

module.exports = router;

