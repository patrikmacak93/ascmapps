/*
  ============================================================
  NASTAVENÍ APPKY
  ============================================================
  Co je v tomhle souboru: VŠECHNY hodnoty, které se můžou lišit
  server od serveru (adresy, cesty k souborům, porty). Žádná
  logika tu není - jen hodnoty. Když appku přesouváš na jiný
  server, nebo se změní adresa shared-api, uprav to tady a nikde
  jinde.
*/

"use strict";

module.exports = {
  // Na jakém portu poslouchá TATO appka (pck_forecast backend).
  PORT: process.env.PORT || 3000,

  // Adresa sdíleného SQL API (shared-api) - tam appka posílá SQL
  // dotazy z sql-dotazy.js. Pokud shared-api běží jinde/na jiném
  // portu, uprav tuhle adresu (nebo nastav proměnnou prostředí
  // PCK_SHARED_API_BASE).
  SQL_CONNECTOR_URL:
    process.env.PCK_SQL_CONNECTOR_BASE,
  SQL_CONNECTOR_API_KEY:
    process.env.API_KEY
};
