/* =========================================================
   ZÁLOŽKA "EMPTIES"

   Načtení, zobrazení, přidání řádku a inline editace buněk v
   tabulce nákupů obalů (Empties). Každá změna buňky se rovnou
   uloží na server (PUT /api/empties/:id v server/api-routes.js).
========================================================= */
import { $, escapeHtml, emptiesUrl, projectsUrl, emptiesColumns, appState } from "../common/zaklad.js";

export function initEmptiesTab() {
  $("loadEmptiesBtn").addEventListener("click", loadEmptiesData);
  $("addEmptiesBtn").addEventListener("click", addEmptyRow);
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

export async function addEmptyRow() {
  try {
    const res = await fetch(emptiesUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        SAP_ID: "",
        Project: "",
        Loop: null,
        Loop_simulace: null,
        Nakoupeno: null,
        Disponent: "",
        Cena_za_ks: null,
        Pro_budget_budeme_dokupovat: null
      })
    });

    if (!res.ok) throw new Error(await res.text());
    await loadEmptiesData();
  } catch (err) {
    alert("Chyba při přidání řádku: " + err.message);
  }
}

export function renderEmptiesTable() {
  const table = $("emptiesTable");
  const thead = table.tHead || table.createTHead();
  const tbody = table.tBodies[0] || table.createTBody();
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const headerRow = document.createElement("tr");
  headerRow.innerHTML = emptiesColumns.map(c => `<th>${escapeHtml(labelForEmptyColumn(c))}</th>`).join("");
  thead.appendChild(headerRow);

  const frag = document.createDocumentFragment();

  for (const row of appState.emptiesData) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    tr.dataset.id = row.EmptiesID;

    for (const col of emptiesColumns) {
      const td = document.createElement("td");
      td.className = "editable-cell";
      td.dataset.field = col;

      if (col === "Project") {
        const select = document.createElement("select");
        select.className = "edit-input";
        select.style.padding = "4px 6px";

        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "";
        select.appendChild(emptyOpt);

        for (const p of appState.projectOptions) {
          const opt = document.createElement("option");
          opt.value = p;
          opt.textContent = p;
          select.appendChild(opt);
        }

        select.value = row[col] ?? "";

        select.addEventListener("change", async () => {
          const newValue = select.value;
          try {
            const res = await fetch(`${emptiesUrl}/${row.EmptiesID}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ field: "Project", value: newValue })
            });

            if (!res.ok) throw new Error(await res.text());

            const idx = appState.emptiesData.findIndex(x => String(x.EmptiesID) === String(row.EmptiesID));
            if (idx !== -1) appState.emptiesData[idx].Project = newValue;

            td.innerHTML = "";
            td.textContent = newValue;
            td.classList.add("editable-cell");
          } catch (err) {
            alert("Chyba při ukládání projektu: " + err.message);
            select.value = row[col] ?? "";
          }
        });

        td.appendChild(select);
      } else {
        td.textContent = formatEmptyValue(col, row[col]);
      }

      tr.appendChild(td);
    }

    frag.appendChild(tr);
  }

  tbody.appendChild(frag);

  if (!table.__delegationBound) {
    table.__delegationBound = true;
    tbody.addEventListener("click", (e) => {
      const td = e.target.closest("td");
      if (!td) return;
      const tr = td.parentElement;
      if (!tr) return;

      const field = td.dataset.field;
      if (!field || field === "Project") return;

      const id = Number(tr.dataset.id);
      if (!Number.isFinite(id)) return;

      startEditCell(td, id, field);
    });
  }
}

export function startEditCell(td, id, field) {
  if (field === "Project") return;
  if (td.querySelector("input")) return;

  const displayValue = td.textContent.trim();
  const rawValue = getRawValueForEdit(field, displayValue);

  td.innerHTML = "";
  const input = document.createElement("input");
  input.className = "edit-input";
  input.type = "text";
  input.inputMode = isNumericField(field) ? "decimal" : "text";
  input.value = rawValue;

  const save = async () => {
    const raw = input.value.trim();
    const newValue = normalizeInputValue(field, raw);

    try {
      const res = await fetch(`${emptiesUrl}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value: newValue })
      });

      if (!res.ok) throw new Error(await res.text());

      const idx = appState.emptiesData.findIndex(x => String(x.EmptiesID) === String(id));
      if (idx !== -1) appState.emptiesData[idx][field] = newValue;

      td.textContent = formatEmptyValue(field, newValue);
    } catch (err) {
      alert("Chyba při ukládání: " + err.message);
      td.textContent = displayValue;
    }
  };

  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { e.preventDefault(); td.textContent = displayValue; }
  });

  input.addEventListener("blur", save);
  td.appendChild(input);
  input.focus();
  input.select();
}

export function getRawValueForEdit(field, displayValue) {
  if (!displayValue) return "";
  if (field === "Cena_za_ks") {
    return displayValue.replace(/\s?CZK$/i, "").replace(/\s/g, "").replace(",", ".");
  }
  if (["Loop", "Loop_simulace", "Nakoupeno", "Pro_budget_budeme_dokupovat"].includes(field)) {
    return displayValue.replace(/\s/g, "").replace(",", ".");
  }
  return displayValue;
}

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
  if (field === "Loop" || field === "Loop_simulace") return Number.parseInt(raw, 10);
  if (field === "Nakoupeno" || field === "Cena_za_ks" || field === "Pro_budget_budeme_dokupovat") return Number(raw);
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
