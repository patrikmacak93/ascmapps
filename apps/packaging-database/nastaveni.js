/*
  ============================================================
  NASTAVENÍ BACKENDU OBALOVÉ DATABÁZE
  ============================================================
  Všechny hodnoty, které se liší server od serveru (adresy, cesty,
  porty, klíče). Žádná logika — jen hodnoty. Když se appka stěhuje
  nebo se změní adresa sql-connectoru, mění se to TADY a nikde jinde.

  Proč tenhle backend vůbec existuje, když máme sql-connector:
  sql-connector se otevírá jen na API klíč (hlavička x-api-key).
  Kdyby ho volal přímo prohlížeč, musel by ten klíč být zapsaný
  v JavaScriptu, který si může kdokoliv na intranetu zobrazit —
  a s ním by pak mohl sáhnout na VŠECHNY endpointy connectoru
  (Empties, Budget, ...), ne jen na obaly. Klíč proto zůstává tady
  na serveru, přesně jako u pck_forecast.
  Druhý důvod: nahrávání PSDS souborů. To do sql-connectoru nepatří —
  connector mluví s databází, ne s diskem.
*/

"use strict";

const path = require("path");

module.exports = {
  // Na jakém portu poslouchá TENTO backend (při ručním spuštění
  // `node server.js`; pod IIS/iisnode port řeší iisnode sám).
  PORT: process.env.PORT || 3100,

  // Adresa sql-connectoru + jeho API klíč. Stejné hodnoty jako
  // v Packaging/pck_forecast/server/nastaveni.js.
  SQL_CONNECTOR_URL:
    process.env.PCK_SQL_CONNECTOR_BASE ||
    "http://fsas00025vma.vt1.vitesco.com:4000/api/v1",
  SQL_CONNECTOR_API_KEY:
    process.env.PCK_SQL_CONNECTOR_API_KEY || "ZDE_DOPLNIT_API_KLIC",

  // ---- PSDS dokumenty ----
  // Adresář na disku serveru, kam se ukládají nahrané PSDS soubory.
  // Původně to řešil Node-RED file node (D:\PSDS\).
  PSDS_DIR: process.env.PCK_PSDS_DIR || "D:\\PSDS",

  // Veřejná adresa, pod kterou jsou ty soubory dostupné z prohlížeče.
  // Tahle hodnota se ukládá do sloupce URL1 v databázi, takže ji neměň
  // bez rozmyslu — staré záznamy odkazují na starou adresu.
  // Když necháš prázdné, adresu složí prohlížeč z adresy stránky
  // (…/PackagingDatabase/api/psds/<soubor>) — což je pro nasazení pod IIS
  // to správné. Vyplň jen tehdy, když soubory servíruje něco jiného
  // (jiný web, fileserver).
  PSDS_PUBLIC_BASE: process.env.PCK_PSDS_PUBLIC_BASE || "",

  // Maximální velikost nahrávaného souboru (v bajtech).
  PSDS_MAX_BYTES: 25 * 1024 * 1024, // 25 MB

  // Povolené přípony PSDS souborů.
  PSDS_POVOLENE_PRIPONY: [".pdf", ".xlsx", ".xls", ".docx", ".doc", ".png", ".jpg", ".jpeg"],
};

