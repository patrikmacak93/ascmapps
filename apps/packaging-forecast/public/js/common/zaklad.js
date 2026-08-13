/* =========================================================
   ZÁKLAD - věci, které používá skoro každá část appky

   Tenhle soubor má 4 části (každá označená nadpisem):
   1. DOM HELPER   - zkratka pro vyhledání HTML prvku podle id.
   2. FORMÁTOVÁNÍ  - malé funkce na čísla a text.
   3. ADRESY API   - kam appka posílá požadavky (backend appky,
                      NE shared-api - tam appka nechodí přímo).
   4. STAV APPKY   - sdílená data, která si appka pamatuje, dokud
                      je stránka otevřená (načtená data, filtry,
                      co je právě rozbalené/sbalené...).
========================================================= */

/* ---------------------------------------------------------
   1. DOM HELPER
--------------------------------------------------------- */
export const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------
   2. FORMÁTOVÁNÍ
--------------------------------------------------------- */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("cs-CZ") : "";
}

export function normalizeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function parseRequirementPeriodSortKey(label) {
  const s = String(label || "");
  const m = s.match(/(\d{1,2})\/(\d{4})/);
  if (!m) return 0;
  return Number(m[2]) * 100 + Number(m[1]);
}

/* ---------------------------------------------------------
   3. ADRESY API (backend appky pck_forecast, viz ../../server.js)
   Appka teď běží přes HTTPS pod doménovým jménem serveru (musí
   sedět s CN v certifikátu: fsas00025vma.vt1.vitesco.com) - IP
   adresa by prohlížeč s certifikátem odmítl.
--------------------------------------------------------- */
const API_BASE = "/packagingForecast/api";

export const apiUrl = `${API_BASE}/pckpoolbalance`;
export const weeklyOverviewUrl = `${API_BASE}/weekly-overview`;
export const yearlyOverviewUrl = `${API_BASE}/yearly-overview`;
export const emptiesUrl = `${API_BASE}/empties`;
export const projectsUrl = `${API_BASE}/projects`;
export const budgetUrl = `${API_BASE}/budget`;

export const emptiesColumns = [
  "SAP_ID",
  "Project",
  "Loop",
  "Loop_simulace",
  "Nakoupeno",
  "Disponent",
  "Cena_za_ks",
  "Pro_budget_budeme_dokupovat"
];

/* ---------------------------------------------------------
   4. STAV APPKY (sdílený mutovatelný stav mezi moduly)
   Objekty se importují podle reference, takže úpravy vlastností
   (ne přepisování celého importu) se promítnou všude tam, kde je
   stav použit.
--------------------------------------------------------- */
export const appState = {
  paretoChart: null,
  emptiesData: [],
  budgetData: [],
  projectOptions: [],
  mainDataCache: [],
  paretoPeriodRows: []
};

export const pivotTableData = {
  weeklyTable: null,
  yearlyTable: null
};

export const needsToggles = {
  weeklyTable: { material: false, packaging: false, poolSim: false },
  yearlyTable: { material: false, packaging: false, poolSim: false }
};

export const tableStates = {
  weeklyTable: { initialized: false, collapsedSap: new Set(), collapsedProject: new Set(), allSapKeys: [], allProjectKeys: [] },
  yearlyTable: { initialized: false, collapsedSap: new Set(), collapsedProject: new Set(), allSapKeys: [], allProjectKeys: [] }
};

export const tableFilters = {
  weeklyTable: { categorySelected: null, disponentSelected: null, periodsSelected: null },
  yearlyTable: { categorySelected: null, disponentSelected: null, periodsSelected: null },
  emptiesTable: { sapSelected: null, projectSelected: null, disponentSelected: null },
  budgetTable: { sapSelected: null }
};

export const filterPopoverState = {
  current: null
};

export const hoverState = {
  tableId: null,
  rowKey: null,
  colIndex: null,
  cellKey: null
};

export const selectionState = {
  weeklyTable: { rowKey: null, colIndex: null, cellKey: null },
  yearlyTable: { rowKey: null, colIndex: null, cellKey: null }
};

