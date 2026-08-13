/*
  ============================================================
  API ROUTY APPKY (vše, co appka nabízí prohlížeči)
  ============================================================
  Tenhle soubor obsahuje všechny webové adresy (routy), na
  které appka umí odpovědět. Každá routa dělá totéž:
  1. vezme SQL dotaz z sql-dotazy.js,
  2. pošle ho přes shared-api-klient.js na shared-api,
  3. výsledek případně trochu upraví (spočítá pivot tabulku,
     spojí dvě sady dat...) a pošle ho prohlížeči jako JSON.

  Přehled rout:
    GET  /api/pckpoolbalance    - tabulka "PckPoolBalance"
    GET  /api/weekly-overview   - záložka "Týdenní přehled"
    GET  /api/yearly-overview   - záložka "Roční přehled"
    GET  /api/pareto            - záložka "Grafy" (Pareto graf)
    GET  /api/projects          - seznam projektů (pro Empties)
    GET  /api/empties           - záložka "Empties" - načtení
    POST /api/empties           - záložka "Empties" - přidání řádku
    PUT  /api/empties/:id       - záložka "Empties" - úprava buňky
*/

"use strict";

const express = require("express");

const {volatConnector} = require('../services/sql_connector-klient')
const {
  cacheGet,
  cacheSet,
  odeslatJsonSEtag,
  sestavitPivotTabulku
} = require("../utils/helper");

const router = express.Router();
const CACHE_TTL_SEKUND = 30;

/* ===========================================================
   GET /api/pckpoolbalance
=========================================================== */
router.get("/pckpoolbalance", async (req, res) => {
  try {
    let data = cacheGet("pckpoolbalance");

    if (data === undefined) {
      const vysledek = await volatConnector("/packaging");
      data = vysledek.data;
      cacheSet("pckpoolbalance", data, CACHE_TTL_SEKUND);
    }

    odeslatJsonSEtag(req, res, data, CACHE_TTL_SEKUND);
  } catch (err) {
    console.error("CHYBA /api/pckpoolbalance:", err.message);
    res.status(err.statusCode || 500).json({ error: "Chyba při načítání dat.", detail: err.message });
  }
});

/* ===========================================================
   GET /api/weekly-overview a GET /api/yearly-overview
   (stejná logika, jen jiný typ období - "week" vs "month")
=========================================================== */
async function nacistPrehled(periodType, cacheKlic) {
  let pivot = cacheGet(cacheKlic);
  if (pivot !== undefined) return pivot;

  const vysledek = await volatConnector("/packaging", {query: { period_type: periodType} });
  pivot = sestavitPivotTabulku(vysledek.data, periodType, ["PckPoolBalance", "PckPoolBalanceSim", "requirement_qty", "RequiredPackagingQty"]);
  cacheSet(cacheKlic, pivot, CACHE_TTL_SEKUND);
  return pivot;
}

router.get("/weekly-overview", async (req, res) => {
  try {
    const pivot = await nacistPrehled("week", "weekly-overview");
    odeslatJsonSEtag(req, res, pivot, CACHE_TTL_SEKUND);
  } catch (err) {
    console.error("CHYBA /api/weekly-overview:", err.message);
    res.status(err.statusCode || 500).json({ error: "Chyba při načítání týdenního přehledu.", detail: err.message });
  }
});

router.get("/yearly-overview", async (req, res) => {
  try {
    const pivot = await nacistPrehled("month", "yearly-overview");
    odeslatJsonSEtag(req, res, pivot, CACHE_TTL_SEKUND);
  } catch (err) {
    console.error("CHYBA /api/yearly-overview:", err.message);
    res.status(err.statusCode || 500).json({ error: "Chyba při načítání ročního přehledu.", detail: err.message });
  }
});

/* ===========================================================
   GET /api/pareto
=========================================================== */
router.get("/pareto", async (req, res) => {
  try {
    const obdobi = String(req.query.period || "").trim() || null;
    const cacheKlic = `pareto:${obdobi || "__all__"}`;

    let data = cacheGet(cacheKlic);

    if (data === undefined) {
      const [potreba, nakoupeno] = await Promise.all([
        volatConnector("/pareto/potreba",{ query: { period: obdobi } }),
        volatConnector("/pareto/nakoupeno")
      ]);

      const nakoupenoMapa = new Map(
        nakoupeno.rows.map((r) => [String(r.SAP_ID ?? "").trim(), Number(r.Nakoupeno ?? 0)])
      );

      data = potreba.rows.map((r) => {
        const sap = String(r.SAP_ID ?? "").trim();
        return {
          SAP_ID: sap,
          RequiredPackagingQty: Number(r.RequiredPackagingQty ?? 0),
          Nakoupeno: Number(nakoupenoMapa.get(sap) ?? 0)
        };
      });

      cacheSet(cacheKlic, data, CACHE_TTL_SEKUND);
    }

    odeslatJsonSEtag(req, res, data, CACHE_TTL_SEKUND);
  } catch (err) {
    console.error("CHYBA /api/pareto:", err.message);
    res.status(err.statusCode || 500).json({ error: "Chyba při načítání dat pro Pareto graf.", detail: err.message });
  }
});

/* ===========================================================
   GET /api/projects
=========================================================== */
router.get("/projects", async (req, res) => {
  try {
    let projects = cacheGet("projects");

    if (projects === undefined) {
      const vysledek = await volatConnector("/projects");
      projects = vysledek.data;
      cacheSet("projects", projects, 300);
    }

    odeslatJsonSEtag(req, res, projects, 300);
  } catch (err) {
    console.error("CHYBA /api/projects:", err.message);
    res.status(err.statusCode || 500).json({ error: "Chyba při načítání seznamu projektů.", detail: err.message });
  }
});

/* ===========================================================
   GET / POST /api/empties, PUT /api/empties/:id
=========================================================== */
router.get("/empties", async (req, res) => {
  try {
    const vysledek = await volatConnector("/empties");
    odeslatJsonSEtag(req, res, vysledek.data, 5);
  } catch (err) {
    console.error("CHYBA /api/empties:", err.message);
    res.status(err.statusCode || 500).json({ error: "Chyba při načítání tabulky Empties.", detail: err.message });
  }
});

router.post("/empties", async (req, res) => {
  const cislo = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  const {
    SAP_ID = null,
    Project = null,
    Loop = null,
    Loop_simulace = null,
    Nakoupeno = null,
    Disponent = null,
    Cena_za_ks = null,
    Pro_budget_budeme_dokupovat = null
  } = req.body || {};

  try {
    const vysledek = await volatConnector("/empties", {
      method: "POST",
      body: {
        SAP_ID, Project, Loop, Loop_simulace, Nakoupeno, Disponent, Cena_za_ks, Pro_budget_budeme_dokupovat
      }
    });

    res.json({ ok: true, EmptiesID: vysledek.data?.EmptiesID ?? null});
  } catch (err) {
    console.error("CHYBA POST /api/empties:", err.message);
    res.status(err.statusCode || 500).json({ error: "Chyba při přidání nového řádku do Empties.", detail: err.message });
  }
});

router.put("/empties/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { field, value } = req.body || {};

  if (!Number.isFinite(id)) return res.status(400).json({ error: "Neplatné EmptiesID." });

  try {
    const vysledek = await volatConnector(`/empties/${id}`, {
      method: "PUT",
      body: { field, value }
    });
    res.json({ ok: true, updatedRows: vysledek.updatedRows });
  } catch (err) {
    console.error("CHYBA PUT /api/empties/:id:", err.message);
    res.status(err.statusCode || 500).json({ error: "Chyba při ukládání změny.", detail: err.message });
  }
});

/* ===========================================================
   GET /api/budget
   -----------------------------------------------------------
   Načte celý view [FSTASCM].[pckForecast].[vw_budget] přes
   sql-connector (/budget) a pošle prohlížeči pole řádků.
=========================================================== */
router.get("/budget", async (req, res) => {
  try {
    let data = cacheGet("budget");

    if (data === undefined) {
      const vysledek = await volatConnector("/budget");
      data = vysledek.data;
      cacheSet("budget", data, CACHE_TTL_SEKUND);
    }

    odeslatJsonSEtag(req, res, data, CACHE_TTL_SEKUND);
  } catch (err) {
    console.error("CHYBA /api/budget:", err.message);
    res.status(err.statusCode || 500).json({ error: "Chyba při načítání tabulky Budget.", detail: err.message });
  }
});

module.exports = router;

