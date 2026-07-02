/*
  ============================================================
  SQL DOTAZY POUŽÍVANÉ TOUTO APPKOU
  ============================================================
  Tohle je JEDINÉ místo v appce, kde je napsaný skutečný SQL
  text. Appka pošle jeden z těchto dotazů (+ parametry) na
  sdílené SQL API (shared-api), to ho spustí v databázi a vrátí
  výsledek - viz server/shared-api-klient.js.

  Proč jsou dotazy takhle pohromadě na jednom místě:
  - je hned vidět, odkud appka bere jaká data,
  - když se v databázi změní název tabulky/sloupce, opravuje se
    to jen tady, ne po celé appce.

  DŮLEŽITÉ - jak se to používá bezpečně:
  Konkrétní HODNOTY (které SAP_ID, jaké období...) se do dotazu
  NEVKLÁDAJÍ jako text. Používají se pojmenované parametry
  (@nazev) a jejich skutečná hodnota se posílá zvlášť (viz
  volání spustitDotaz(sql, { nazev: hodnota }) v server/api-routes.js).
  Díky tomu appka nemůže omylem (ani úmyslně, kdyby někdo zadal
  divný text do formuláře) poslat do databáze škodlivý SQL text
  místo obyčejné hodnoty (tzv. SQL injection).
*/

"use strict";

module.exports = {
  // Všechna data z reportovacího view, bez filtru - používá se pro
  // tabulku "PckPoolBalance" (souhrnný přehled).
  VSECHNA_DATA_PACKAGING: `
    SELECT period_type, period_label, SAP_ID, local_material, Project,
           PartName, Disponent, PckPoolBalance, requirement_qty, RequiredPackagingQty
    FROM [FSTASCM].[pckForecast].[vw_APR_PackagingSAP]
    ORDER BY period_type, period_label, SAP_ID, Project, local_material
  `,

  // Data jen za jeden typ období ('week' nebo 'month') - používá se
  // pro záložky "Týdenní přehled" a "Roční přehled".
  DATA_PACKAGING_PODLE_OBDOBI: `
    SELECT period_type, period_label, SAP_ID, local_material, Project,
           PartName, Disponent, PckPoolBalance, requirement_qty, RequiredPackagingQty
    FROM [FSTASCM].[pckForecast].[vw_APR_PackagingSAP]
    WHERE period_type = @typObdobi
    ORDER BY period_label, SAP_ID, Project, local_material
  `,

  // Součet potřeby obalů za měsíc, seskupeno po SAP_ID - pro Pareto
  // graf (sloupce). @obdobi může být NULL - pak se sečtou všechny měsíce.
  PARETO_POTREBA_OBALU: `
    SELECT SAP_ID, SUM(RequiredPackagingQty) AS RequiredPackagingQty
    FROM [FSTASCM].[pckForecast].[vw_APR_PackagingSAP]
    WHERE period_type = 'month'
      AND (@obdobi IS NULL OR period_label = @obdobi)
    GROUP BY SAP_ID
    ORDER BY SUM(RequiredPackagingQty) DESC
  `,

  // Součet nákupů obalů, seskupeno po SAP_ID - pro Pareto graf (linka).
  PARETO_NAKOUPENO: `
    SELECT [SAP ID] AS SAP_ID, SUM(Nakoupeno) AS Nakoupeno
    FROM [FSTASCM].[pckForecast].[Empties]
    WHERE [SAP ID] IS NOT NULL AND [SAP ID] <> ''
    GROUP BY [SAP ID]
  `,

  // Seznam existujících projektů bez duplicit - pro našeptávač v Empties.
  SEZNAM_PROJEKTU: `
    SELECT DISTINCT Project
    FROM [FSTASCM].[pckForecast].[vw_APR_PackagingSAP]
    WHERE Project IS NOT NULL AND Project <> ''
    ORDER BY Project
  `,

  // Celá tabulka Empties.
  VSECHNY_EMPTIES: `
    SELECT EmptiesID, [SAP ID] AS SAP_ID, Projekt AS Project, Loop,
           [Loop simulace] AS Loop_simulace, Nakoupeno, Disponent,
           [Cena za ks] AS Cena_za_ks,
           [Pro budget budeme dokupovat] AS Pro_budget_budeme_dokupovat
    FROM [FSTASCM].[pckForecast].[Empties]
    ORDER BY EmptiesID
  `,

  // Přidání nového řádku do Empties (tlačítko "Přidat řádek").
  PRIDAT_EMPTIES_RADEK: `
    INSERT INTO [FSTASCM].[pckForecast].[Empties]
      ([SAP ID], Projekt, Loop, [Loop simulace], Nakoupeno, Disponent,
       [Cena za ks], [Pro budget budeme dokupovat])
    OUTPUT INSERTED.EmptiesID AS EmptiesID
    VALUES (@SAP_ID, @Project, @Loop, @Loop_simulace, @Nakoupeno, @Disponent,
            @Cena_za_ks, @Pro_budget_budeme_dokupovat)
  `,

  // ---- Úprava JEDNÉ buňky v Empties (inline editace v tabulce) ----
  // Sloupec se nedá poslat jako parametr (SQL to nepodporuje - parametr
  // smí být jen HODNOTA, ne název sloupce), proto se název sloupce
  // dosadí do textu dotazu přímo. Aby to bylo bezpečné, tahle funkce
  // se nikdy nevolá s textem přímo od uživatele - server/api-routes.js
  // nejdřív název pole (např. "Nakoupeno") přeloží přes pevně daný
  // seznam (EDITOVATELNA_POLE_EMPTIES) na skutečný název sloupce, a
  // teprve ten bezpečný, předem známý název sem pošle.
  upravitEmptiesSloupec(sqlNazevSloupce) {
    return `
      UPDATE [FSTASCM].[pckForecast].[Empties]
      SET [${sqlNazevSloupce}] = @hodnota
      WHERE EmptiesID = @id
    `;
  },

  // Pevný seznam polí Empties, která appka smí editovat - mapování
  // "alias použitý appkou" -> "skutečný název sloupce v SQL tabulce".
  // Používá server/api-routes.js u PUT /api/empties/:id.
  EDITOVATELNA_POLE_EMPTIES: {
    SAP_ID: "SAP ID",
    Project: "Projekt",
    Loop: "Loop",
    Loop_simulace: "Loop simulace",
    Nakoupeno: "Nakoupeno",
    Disponent: "Disponent",
    Cena_za_ks: "Cena za ks",
    Pro_budget_budeme_dokupovat: "Pro budget budeme dokupovat"
  }
};
