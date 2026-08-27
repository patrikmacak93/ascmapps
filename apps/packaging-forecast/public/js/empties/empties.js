/* =========================================================
   ZÁLOŽKA "EMPTIES"

   Zobrazení tabulky nákupů obalů (Empties) a správa záznamů -
   stejně jako v obalové databázi:

     - u každého řádku tlačítka "Upravit" a "Smazat"
     - nad tabulkou "Přidat záznam" (otevře prázdný panel)
     - editace i zakládání probíhá ve vyjíždějícím postranním
       panelu (skupiny polí vlevo, formulář vpravo, dole Uložit)

   Ukládání:
     - EDIT   -> jen ZMĚNĚNÁ pole, PUT /api/empties/:id {field,value}
     - CREATE -> celý záznam, POST /api/empties {SAP_ID, Project, ...}
     - DELETE -> DELETE /api/empties/:id
   (endpointy viz server/routes/index.js a sql-connector).
========================================================= */
import { $, emptiesUrl, projectsUrl, emptiesColumns, appState, tableFilters } from "../common/zaklad.js";
import { openTextFilterPopover, rowPassesTextFilter } from "../common/filters.js";

const FILTERABLE_EMPTIES_COLUMNS = {
  SAP_ID: { selectedKey: "sapSelected", noteText: "Tip: filtruje se podle textu ve sloupci SAP ID." },
  Project: { selectedKey: "projectSelected", noteText: "Tip: filtruje se podle textu ve sloupci Projekt." },
  Disponent: { selectedKey: "disponentSelected", noteText: "Tip: filtruje se podle textu ve sloupci Disponent." }
};

// Rozdělení polí do skupin pro levou lištu panelu (jako v obalové databázi).
const EMPTIES_GROUPS = [
  { id: "zaklad", label: "Základ", keys: ["SAP_ID", "Project", "Disponent"] },
  { id: "mnozstvi", label: "Množství a cena", keys: ["Loop", "Loop_simulace", "Nakoupeno", "Cena_za_ks", "Pro_budget_budeme_dokupovat"] }
];

function getEmptiesColumnText(col) {
  return (row) => String(row[col] ?? "").trim();
}

export function initEmptiesTab() {
  const loadEmptiesBtn = $("loadEmptiesBtn");
  if (loadEmptiesBtn) loadEmptiesBtn.addEventListener("click", loadEmptiesData);

  // "Přidat záznam" otevře prázdný panel v režimu vytvoření.
  $("addEmptiesBtn").addEventListener("click", () => openEmptiesPanelCreate());

  // Postaví formulář v panelu a napojí jeho ovládání.
  initEmptiesPanel();
}

export async function loadEmptiesData() {
  const status = $("emptiesStatus");
  status.textContent = "Načítám Empties...";

  try {
    const [emptiesRes, projectsRes] = await Promise.all([
      fetch(emptiesUrl, { cache: "no-store" }),
      fetch(projectsUrl, { cache: "force-cache" })
    ]);

    if (!emptiesRes.ok) throw new Error(`Empties API HTTP ${emptiesRes.status}: ${await emptiesRes.text()}`);
    if (!projectsRes.ok) throw new Error(`Projects API HTTP ${projectsRes.status}: ${await projectsRes.text()}`);

    appState.emptiesData = await emptiesRes.json();
    if (!Array.isArray(appState.emptiesData)) appState.emptiesData = [];
    appState.projectOptions = await projectsRes.json();
    if (!Array.isArray(appState.projectOptions)) appState.projectOptions = [];

    renderEmptiesTable();
    status.textContent = `Načteno ${appState.emptiesData.length} řádků Empties.`;
  } catch (err) {
    console.error(err);
    status.textContent = "Chyba při načítání Empties: " + err.message;
  }
}

async function deleteEmptiesRow(id) {
  const row = appState.emptiesData.find(r => String(r.EmptiesID) === String(id));
  const label = row && row.SAP_ID ? `${id} (${row.SAP_ID})` : id;

  if (!confirm(`Smazat záznam ${label}? Akce je nevratná.`)) return;

  try {
    const res = await fetch(`${emptiesUrl}/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
    await loadEmptiesData();
  } catch (err) {
    alert("Smazání selhalo: " + err.message);
  }
}

/* ---------------------------------------------------------
   Vykreslení tabulky
   První sloupec = akce (Upravit + Smazat). Datové buňky jen ke čtení.
--------------------------------------------------------- */
export function renderEmptiesTable() {
  const table = $("emptiesTable");
  const thead = table.tHead || table.createTHead();
  const tbody = table.tBodies[0] || table.createTBody();
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const headerRow = document.createElement("tr");

  const thAction = document.createElement("th");
  thAction.className = "empties-action-col";
  headerRow.appendChild(thAction);

  for (const col of emptiesColumns) {
    const th = document.createElement("th");
    const filterCfg = FILTERABLE_EMPTIES_COLUMNS[col];

    if (!filterCfg) {
      th.textContent = labelForEmptyColumn(col);
      headerRow.appendChild(th);
      continue;
    }

    const flex = document.createElement("div");
    flex.className = "th-flex";

    const title = document.createElement("span");
    title.textContent = labelForEmptyColumn(col);

    const filterBtn = document.createElement("button");
    filterBtn.className = "filter-btn";
    filterBtn.type = "button";
    filterBtn.title = `Filtrovat ${labelForEmptyColumn(col)}`;
    filterBtn.textContent = "▾";
    filterBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openTextFilterPopover({
        tableId: "emptiesTable",
        anchorEl: filterBtn,
        flatRows: appState.emptiesData,
        noteText: filterCfg.noteText,
        selectedKey: filterCfg.selectedKey,
        extractor: getEmptiesColumnText(col),
        onApply: renderEmptiesTable
      });
    });

    flex.append(title, filterBtn);
    th.appendChild(flex);
    headerRow.appendChild(th);
  }

  thead.appendChild(headerRow);

  const sapSelected = tableFilters.emptiesTable.sapSelected;
  const projectSelected = tableFilters.emptiesTable.projectSelected;
  const disponentSelected = tableFilters.emptiesTable.disponentSelected;
  const sapSet = sapSelected ? new Set(sapSelected) : null;
  const projectSet = projectSelected ? new Set(projectSelected) : null;
  const disponentSet = disponentSelected ? new Set(disponentSelected) : null;

  const visibleRows = appState.emptiesData.filter(row =>
    rowPassesTextFilter(row, sapSet, getEmptiesColumnText("SAP_ID")) &&
    rowPassesTextFilter(row, projectSet, getEmptiesColumnText("Project")) &&
    rowPassesTextFilter(row, disponentSet, getEmptiesColumnText("Disponent"))
  );

  const frag = document.createDocumentFragment();

  for (const row of visibleRows) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    tr.dataset.id = row.EmptiesID;

    // Sloupec s akcemi: Upravit + Smazat.
    const tdAction = document.createElement("td");
    tdAction.className = "empties-action-cell";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-empties-edit";
    editBtn.dataset.id = row.EmptiesID;
    editBtn.textContent = "Upravit";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-empties-delete";
    delBtn.dataset.id = row.EmptiesID;
    delBtn.textContent = "Smazat";

    tdAction.append(editBtn, delBtn);
    tr.appendChild(tdAction);

    // Datové buňky - jen ke čtení.
    for (const col of emptiesColumns) {
      const td = document.createElement("td");
      td.dataset.field = col;
      td.textContent = formatEmptyValue(col, row[col]);
      tr.appendChild(td);
    }

    frag.appendChild(tr);
  }

  tbody.appendChild(frag);

  // Delegovaný klik: Upravit -> panel, Smazat -> potvrzení + DELETE.
  if (!table.__delegationBound) {
    table.__delegationBound = true;
    tbody.addEventListener("click", (e) => {
      const editBtn = e.target.closest(".btn-empties-edit");
      if (editBtn) { openEmptiesPanel(editBtn.dataset.id); return; }

      const delBtn = e.target.closest(".btn-empties-delete");
      if (delBtn) { deleteEmptiesRow(delBtn.dataset.id); return; }
    });
  }
}

/* =========================================================
   POSTRANNÍ PANEL (úprava i nový záznam)
========================================================= */

let panelDirty = false;
let panelMode = "edit";   // "edit" | "create"
let editingId = null;

function panelField(key) {
  return document.querySelector('#emptiesRecordForm [name="' + CSS.escape(key) + '"]');
}

function sayEmpties(text, type) {
  const m = $("emptiesRecordMessage");
  if (!m) return;
  m.textContent = text || "";
  m.dataset.type = type || "info";
}

function buildEmptiesField(key) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  wrap.dataset.key = key;

  const id = "fe-" + key;
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelForEmptyColumn(key);
  wrap.appendChild(label);

  if (key === "Project") {
    const select = document.createElement("select");
    select.id = id;
    select.name = key;
    wrap.appendChild(select);
  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.name = key;
    input.inputMode = isNumericField(key) ? "decimal" : "text";
    wrap.appendChild(input);
  }

  return wrap;
}

function buildEmptiesForm() {
  const form = $("emptiesRecordForm");
  const nav = $("emptiesRecordNav");
  if (!form || !nav) return;

  nav.innerHTML = "";
  form.querySelectorAll("fieldset").forEach(fs => fs.remove());

  for (const group of EMPTIES_GROUPS) {
    const navBtn = document.createElement("button");
    navBtn.type = "button";
    navBtn.className = "record-nav-item";
    navBtn.dataset.target = group.id;
    navBtn.textContent = group.label;
    navBtn.addEventListener("click", () => setActiveGroup(group.id));
    nav.appendChild(navBtn);

    const fs = document.createElement("fieldset");
    fs.id = "empties-group-" + group.id;
    fs.dataset.group = group.id;

    const legend = document.createElement("legend");
    legend.textContent = group.label;
    fs.appendChild(legend);

    for (const key of group.keys) fs.appendChild(buildEmptiesField(key));
    form.appendChild(fs);
  }
}

function fillProjectSelect() {
  const select = panelField("Project");
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "";
  select.appendChild(empty);

  for (const p of appState.projectOptions) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  }
  select.value = current;
}

function setActiveGroup(id) {
  const nav = $("emptiesRecordNav");
  nav.querySelectorAll(".record-nav-item").forEach(b =>
    b.classList.toggle("active", b.dataset.target === id));
  const fs = document.getElementById("empties-group-" + id);
  if (fs) fs.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Společné otevření panelu. row === null => nový záznam. */
function openPanel(mode, row) {
  panelMode = mode;

  fillProjectSelect();

  // Naplnění polí (u create prázdné).
  for (const key of emptiesColumns) {
    const el = panelField(key);
    if (!el) continue;
    const raw = row ? row[key] : "";

    if (el.tagName === "SELECT") {
      const val = raw == null ? "" : String(raw);
      if (val && !Array.from(el.options).some(o => o.value === val)) {
        const extra = document.createElement("option");
        extra.value = val;
        extra.textContent = val + " (mimo číselník)";
        el.appendChild(extra);
      }
      el.value = val;
    } else {
      el.value = raw == null ? "" : String(raw);
    }
  }

  const modeTag = $("emptiesRecordMode");
  const saveBtn = $("emptiesRecordSave");

  if (mode === "edit" && row) {
    editingId = row.EmptiesID;
    $("f-EmptiesID").value = row.EmptiesID;
    $("emptiesRecordTitle").textContent =
      "Empties #" + row.EmptiesID + (row.SAP_ID ? " · " + row.SAP_ID : "");
    modeTag.textContent = "Upravit";
    modeTag.dataset.mode = "edit";
    saveBtn.textContent = "Uložit změny";
  } else {
    editingId = null;
    $("f-EmptiesID").value = "";
    $("emptiesRecordTitle").textContent = "Nový záznam";
    modeTag.textContent = "Nový";
    modeTag.dataset.mode = "create";
    saveBtn.textContent = "Vytvořit záznam";
  }

  sayEmpties("");
  setActiveGroup(EMPTIES_GROUPS[0].id);

  panelDirty = false;
  $("emptiesRecordPanel").hidden = false;
  $("emptiesRecordBackdrop").hidden = false;
  document.body.classList.add("panel-open");

  const first = $("emptiesRecordForm").querySelector("select, input:not([type=hidden])");
  if (first) first.focus();
}

export function openEmptiesPanel(id) {
  const row = appState.emptiesData.find(r => String(r.EmptiesID) === String(id));
  if (!row) return;
  openPanel("edit", row);
}

export function openEmptiesPanelCreate() {
  openPanel("create", null);
}

function closeEmptiesPanel(force) {
  if (panelDirty && !force) {
    if (!confirm("Máš neuložené změny. Zavřít panel a zahodit je?")) return;
  }
  $("emptiesRecordPanel").hidden = true;
  $("emptiesRecordBackdrop").hidden = true;
  document.body.classList.remove("panel-open");
  panelDirty = false;
  editingId = null;
}

/** Porovná původní a novou hodnotu (prázdné se rovnají, čísla číselně). */
function sameValue(a, b) {
  const na = (a === null || a === undefined || a === "") ? "" : a;
  const nb = (b === null || b === undefined || b === "") ? "" : b;
  if (na === "" && nb === "") return true;
  if (na === "" || nb === "") return false;
  if (!isNaN(Number(na)) && !isNaN(Number(nb))) return Number(na) === Number(nb);
  return String(na) === String(nb);
}

/** Posbírá hodnoty všech polí a znormalizuje je (pro CREATE). */
function collectValues() {
  const out = {};
  for (const key of emptiesColumns) {
    const el = panelField(key);
    if (!el) continue;
    out[key] = normalizeInputValue(key, el.value.trim());
  }
  return out;
}

async function saveEmptiesPanel() {
  const saveBtn = $("emptiesRecordSave");

  if (panelMode === "create") {
    saveBtn.disabled = true;
    sayEmpties("Zakládám záznam…", "info");
    try {
      const res = await fetch(emptiesUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectValues())
      });
      if (!res.ok) throw new Error(await res.text());

      panelDirty = false;
      await loadEmptiesData();     // znovu načte + překreslí
      closeEmptiesPanel(true);
    } catch (err) {
      console.error("Empties create error:", err);
      sayEmpties("Založení selhalo: " + err.message, "error");
    } finally {
      saveBtn.disabled = false;
    }
    return;
  }

  // --- EDIT ---
  if (editingId == null) {
    sayEmpties("Chybí ID záznamu. Otevři ho znovu tlačítkem Upravit.", "error");
    return;
  }
  const row = appState.emptiesData.find(r => String(r.EmptiesID) === String(editingId));
  if (!row) {
    sayEmpties("Záznam nenalezen. Zkus data načíst znovu.", "error");
    return;
  }

  const changes = [];
  for (const key of emptiesColumns) {
    const el = panelField(key);
    if (!el) continue;
    const newVal = normalizeInputValue(key, el.value.trim());
    if (!sameValue(newVal, row[key])) changes.push({ field: key, value: newVal });
  }

  if (changes.length === 0) {
    sayEmpties("Beze změn.", "info");
    return;
  }

  saveBtn.disabled = true;
  sayEmpties("Ukládám změny…", "info");

  try {
    for (const ch of changes) {
      const res = await fetch(`${emptiesUrl}/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: ch.field, value: ch.value })
      });
      if (!res.ok) throw new Error(await res.text());
      row[ch.field] = ch.value;
    }

    panelDirty = false;
    renderEmptiesTable();
    closeEmptiesPanel(true);
  } catch (err) {
    console.error("Empties save error:", err);
    sayEmpties("Uložení selhalo: " + err.message, "error");
  } finally {
    saveBtn.disabled = false;
  }
}

function initEmptiesPanel() {
  const panel = $("emptiesRecordPanel");
  const form = $("emptiesRecordForm");
  if (!panel || !form) {
    console.warn("Empties: panel v HTML chybí - editace/zakládání přes panel nebude fungovat.");
    return;
  }

  buildEmptiesForm();

  form.addEventListener("input", () => { panelDirty = true; });
  form.addEventListener("change", () => { panelDirty = true; });
  form.addEventListener("submit", (e) => { e.preventDefault(); saveEmptiesPanel(); });

  $("emptiesRecordClose").addEventListener("click", () => closeEmptiesPanel(false));
  $("emptiesRecordCancel").addEventListener("click", () => closeEmptiesPanel(false));
  $("emptiesRecordBackdrop").addEventListener("click", () => closeEmptiesPanel(false));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) closeEmptiesPanel(false);
  });
}

/* =========================================================
   Pomocné funkce (formátování / normalizace hodnot)
========================================================= */

export function labelForEmptyColumn(col) {
  const map = {
    SAP_ID: "SAP ID",
    Project: "Projekt",
    Loop: "Loop",
    Loop_simulace: "Loop simulace",
    Nakoupeno: "Nakoupeno",
    Disponent: "Disponent",
    Cena_za_ks: "Cena za ks",
    Pro_budget_budeme_dokupovat: "Pro budget dokupovat"
  };
  return map[col] || col;
}

export function isNumericField(field) {
  return ["Loop", "Loop_simulace", "Nakoupeno", "Cena_za_ks", "Pro_budget_budeme_dokupovat"].includes(field);
}

export function normalizeInputValue(field, raw) {
  if (raw === "") return null;
  if (field === "Loop" || field === "Loop_simulace") return Number.parseInt(raw.replace(",", "."), 10);
  if (field === "Nakoupeno" || field === "Cena_za_ks" || field === "Pro_budget_budeme_dokupovat") return Number(raw.replace(",", "."));
  return raw;
}

export function formatEmptyValue(field, value) {
  if (value === null || value === undefined || value === "") return "";
  if (field === "Cena_za_ks") {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return `${n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CZK`;
  }
  if (["Loop", "Loop_simulace", "Nakoupeno", "Pro_budget_budeme_dokupovat"].includes(field)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
  }
  return String(value);
}
