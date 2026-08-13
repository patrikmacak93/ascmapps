/*
  ============================================================
  POMOCNÉ FUNKCE
  ============================================================
  Věci, které appka potřebuje na pozadí, ale nejsou to přímo
  "SQL data" ani "webová route". Soubor má 4 části, každá
  označená nadpisem:

  1. CACHE       - krátké uložení posledních dat, ať appka
                    nečte SQL úplně pokaždé.
  2. ETAG        - HTTP hlavičky, díky kterým prohlížeč pozná,
                    že se data nezměnila, a nestahuje je znovu.
  3. OBDOBÍ      - rozpoznání "CW 12/2026" / "3/2026" z dat SQL.
  4. PIVOT       - poskládání plochých řádků ze SQL do stromové
                    tabulky (Obal -> Projekt -> Materiál), jak
                    ji appka zobrazuje v Týdenním/Ročním přehledu.
*/

"use strict";

const crypto = require("crypto");

/* ===========================================================
   1. CACHE (krátké uložení dat s expirací - TTL)
   -----------------------------------------------------------
   Účel: endpointy /api/pckpoolbalance, /api/weekly-overview,
   /api/yearly-overview a /api/projects se čtou opakovaně
   (každé kliknutí na "Načíst data" spustí víc GET požadavků).
   Cache uloží poslední výsledek na pár vteřin a vrací ho hned,
   bez nového dotazu do SQL.
=========================================================== */
const cacheStore = new Map();

function cacheGet(key) {
  const entry = cacheStore.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cacheStore.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, value, ttlSeconds) {
  cacheStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/* ===========================================================
   2. ETAG (ať prohlížeč zbytečně nestahuje nezměněná data)
=========================================================== */
function odeslatJsonSEtag(req, res, data, cacheSeconds = 30) {
  const body = JSON.stringify(data);
  const etag = crypto.createHash("sha1").update(body).digest("hex");

  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", `private, max-age=${cacheSeconds}`);

  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.type("application/json").send(body);
}

/* ===========================================================
   3. OBDOBÍ (rozpoznání "CW 12/2026" nebo "3/2026" z dat SQL)
=========================================================== */
function rozpoznatObdobi(label) {
  const s = String(label || "").trim();

  let m = s.match(/cw\s*(\d{1,2})\/(\d{4})/i);
  if (m) {
    const week = Number(m[1]);
    const year = Number(m[2]);
    return {
      type: "week",
      year,
      period: week,
      sortKey: year * 100 + week,
      display: `CW ${String(week).padStart(2, "0")}/${year}`
    };
  }

  m = s.match(/cm\s*(\d{1,2})\/(\d{4})/i);
  if (m) {
    const month = Number(m[1]);
    const year = Number(m[2]);
    return {
      type: "month",
      year,
      period: month,
      sortKey: year * 100 + month,
      display: `${String(month).padStart(2, "0")}/${year}`
    };
  }

  return { type: "unknown", year: 0, period: 0, sortKey: 0, display: s };
}

/* ===========================================================
   4. PIVOT (ploché SQL řádky -> stromová tabulka pro
      Týdenní/Roční přehled: SAP_ID -> Project -> local_material)
=========================================================== */
function cisloNeboNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Poskládá ploché řádky ze SQL do stromové tabulky.
 * Jeden výsledný řádek = SAP_ID + Project + local_material + PartName,
 * a pro každé rozpoznané období přibydou sloupce
 * `${období}__PckPoolBalance`, `${období}__requirement_qty`,
 * `${období}__RequiredPackagingQty`.
 */
function sestavitPivotTabulku(records, mode, metrics = ["PckPoolBalance", "requirement_qty", "RequiredPackagingQty"]) {
  const filtered = records
    .filter((r) => String(r.period_type || "").toLowerCase() === mode)
    .map((r) => ({
      local_material: String(r.local_material ?? "").trim(),
      PartName: String(r.PartName ?? "").trim(),
      period_label: String(r.period_label ?? "").trim(),
      SAP_ID: String(r.SAP_ID ?? "").trim(),
      Project: String(r.Project ?? "").trim(),
      Disponent: String(r.Disponent ?? "").trim(),
      values: Object.fromEntries(metrics.map((m) => [m, cisloNeboNull(r[m])]))
    }));

  const periodsMap = new Map();
  const tree = new Map(); // SAP_ID -> sapNode

  for (const row of filtered) {
    const p = rozpoznatObdobi(row.period_label);
    if (p.type !== mode) continue;

    periodsMap.set(p.display, { sortKey: p.sortKey, label: p.display });

    let sapNode = tree.get(row.SAP_ID);
    if (!sapNode) {
      sapNode = { disponent: row.Disponent || "", projects: new Map() };
      tree.set(row.SAP_ID, sapNode);
    }
    if (!sapNode.disponent && row.Disponent) sapNode.disponent = row.Disponent;

    let materialMap = sapNode.projects.get(row.Project);
    if (!materialMap) {
      materialMap = new Map();
      sapNode.projects.set(row.Project, materialMap);
    }

    let partMap = materialMap.get(row.local_material);
    if (!partMap) {
      partMap = new Map();
      materialMap.set(row.local_material, partMap);
    }

    let item = partMap.get(row.PartName);
    if (!item) {
      item = {
        SAP_ID: row.SAP_ID,
        Project: row.Project,
        Disponent: sapNode.disponent || "",
        local_material: row.local_material,
        PartName: row.PartName,
        values: new Map()
      };
      partMap.set(row.PartName, item);
    }

    if (!item.values.has(p.display)) item.values.set(p.display, row.values);
  }

  const periods = [...periodsMap.values()].sort((a, b) => a.sortKey - b.sortKey).map((x) => x.label);

  const rows = [];
  const sapEntries = [...tree.entries()].sort((a, b) => a[0].localeCompare(b[0], "cs"));

  for (const [sapId, sapNode] of sapEntries) {
    const projectEntries = [...sapNode.projects.entries()].sort((a, b) => a[0].localeCompare(b[0], "cs"));

    for (const [project, materialMap] of projectEntries) {
      const materialEntries = [...materialMap.entries()].sort((a, b) => a[0].localeCompare(b[0], "cs"));

      for (const [, partMap] of materialEntries) {
        const partEntries = [...partMap.entries()].sort((a, b) => a[0].localeCompare(b[0], "cs"));

        for (const [, item] of partEntries) {
          const outRow = {
            SAP_ID: item.SAP_ID,
            Project: item.Project,
            Disponent: item.SAP_ID === sapId ? sapNode.disponent || "" : "",
            local_material: item.local_material
          };

          for (const period of periods) {
            const cell = item.values.get(period) || {};
            // NULL (žádná data pro tenhle materiál/období) se posílá dál jako
            // NULL, ne jako 0 - jinak by "chybí data" a "opravdová nula" byly
            // nerozeznatelné a "chybějící" 0 by kazilo minimum PckPoolBalance
            // při skládání do Projekt/SAP řádků (viz common/pivotTable.js).
            for (const m of metrics) outRow[`${period}__${m}`] = cell[m] ?? null;
          }

          rows.push(outRow);
        }
      }
    }
  }

  return { periods, metrics, rows };
}

module.exports = {
  cacheGet,
  cacheSet,
  odeslatJsonSEtag,
  rozpoznatObdobi,
  sestavitPivotTabulku
};
