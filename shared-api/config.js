/*
  ============================================================
  NASTAVENÍ PŘIPOJENÍ K SQL DATABÁZI
  ============================================================
  Jediné, co je v tomhle souboru: přístupové údaje k databázi
  a port, na kterém appka poslouchá. Žádná logika tu není.

  Pokud se někdy změní SQL server/instance/databáze, uprav to
  tady - nic jiného se měnit nemusí.
=========================================================== */

"use strict";

module.exports = {
  connectionString:
    "Driver={ODBC Driver 17 for SQL Server};Server=FSDB0005\\I0176;Database=FSTASCM;Trusted_Connection=Yes;TrustServerCertificate=Yes;",

  PORT: process.env.PORT || 4000
};
