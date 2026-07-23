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
    process.env.PCK_SQL_CONNECTOR_BASE || "http://fsas00025vma.vt1.vitesco.com:4000/api/v1",
  SQL_CONNECTOR_API_KEY:
    process.env.PCK_SQL_CONNECTOR_API_KEY || "bcc485148f97728f7f7468410cf23e591b94dab0c2fa1fb3717138f952f2d507",

  // ---- Import dat z Excelu (tlačítko "Načíst data") ----
  // PYTHON_PATH - úplná cesta k python.exe NA SERVERU, kde běží
  //   server.js. POZOR: nesmí to být Python nainstalovaný z
  //   Microsoft Store (cesta přes ...\AppData\Local\Microsoft\
  //   WindowsApps\python.exe) - ten je vázaný jen na jeden
  //   uživatelský profil a pod jiným účtem (např. pod tím, co má
  //   přístup do SQL) se vůbec nespustí. Použij klasickou instalaci
  //   z python.org s volbou "Install for all users".
  PYTHON_PATH: process.env.PCK_PYTHON_PATH || "C:\\Program Files\\Python313\\python.exe",

  // SCRIPT_PATH - úplná cesta k load_query1_to_sql.py na serveru.
  SCRIPT_PATH: process.env.PCK_SCRIPT_PATH || "D:\\ASCM_apps\\Packaging\\pck_forecast\\load_query1_to_sql.py",

  // Max. doba běhu importního skriptu, než ho appka násilně ukončí (ms).
  IMPORT_TIMEOUT_MS: 5 * 60 * 1000
};
