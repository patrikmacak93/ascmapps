/*
  ============================================================
  KLIENT PRO SDÍLENÉ SQL API
  ============================================================
  Jedna funkce (spustitDotaz), kterou používají všechny routy v
  server/api-routes.js. Pošle SQL text + parametry (viz
  server/sql-dotazy.js) na shared-api a vrátí zpátky, co SQL
  dotaz v databázi vrátil.

  Appka SAMA neotevírá spojení do databáze - o to se stará jen
  shared-api (viz ../../shared-api/server.js). Tady se jen
  odesílá HTTP požadavek.

  Vyžaduje Node.js 18+ (kvůli vestavěné funkci fetch).
*/

"use strict";

const { SHARED_API_URL } = require("./nastaveni");

/**
 * Spustí SQL dotaz na shared-api a vrátí { rows, rowsAffected }.
 *
 * @param {string} sqlText - text SQL dotazu, viz server/sql-dotazy.js
 * @param {object} params  - hodnoty pro pojmenované parametry v dotazu,
 *                            např. { typObdobi: "week" }
 */
async function spustitDotaz(sqlText, params = {}) {
  let odpoved;

  try {
    odpoved = await fetch(`${SHARED_API_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: sqlText, params })
    });
  } catch (err) {
    const detail = err.cause && err.cause.message ? err.cause.message : err.message;
    const chyba = new Error(`Nepodařilo se spojit se sdíleným SQL API (${SHARED_API_URL}): ${detail}`);
    chyba.statusCode = 502;
    throw chyba;
  }

  const telo = await odpoved.json().catch(() => ({}));

  if (!odpoved.ok) {
    // telo.error je obecný popis ("Chyba při spuštění SQL dotazu."),
    // telo.detail je skutečná hláška od SQL Serveru (např. neplatný
    // název sloupce, chybějící oprávnění...) - chceme obojí, ať se
    // člověk nemusí koukat zvlášť do logu shared-api.
    const zprava = [telo.error, telo.detail].filter(Boolean).join(" - ");
    const chyba = new Error(zprava || `Sdílené SQL API vrátilo chybu HTTP ${odpoved.status}`);
    chyba.statusCode = odpoved.status;
    throw chyba;
  }

  return telo; // { rows: [...], rowsAffected: number }
}

module.exports = { spustitDotaz };
