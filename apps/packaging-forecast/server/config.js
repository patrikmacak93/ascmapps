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
    process.env.API_KEY,

  // ---- Import dat z Excelu (tlačítko "Načíst data") ----
  // PYTHON_PATH - úplná cesta k python.exe NA SERVERU, kde běží
  //   server.js. POZOR: nesmí to být Python nainstalovaný z
  //   Microsoft Store (cesta přes ...\AppData\Local\Microsoft\
  //   WindowsApps\python.exe) - ten je vázaný jen na jeden
  //   uživatelský profil a pod jiným účtem (např. pod tím, co má
  //   přístup do SQL) se vůbec nespustí. Použij klasickou instalaci
  //   z python.org s volbou "Install for all users".
  PYTHON_PATH: process.env.PCK_PYTHON_PATH,

  // SCRIPT_PATH - úplná cesta k load_query1_to_sql.py na serveru.
  SCRIPT_PATH: process.env.PCK_SCRIPT_PATH,

  // Max. doba běhu importního skriptu, než ho appka násilně ukončí (ms).
  IMPORT_TIMEOUT_MS: 5 * 60 * 1000
};
