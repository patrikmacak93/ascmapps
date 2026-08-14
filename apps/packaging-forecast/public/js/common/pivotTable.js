/* =========================================================
   STROMOVÁ TABULKA (POUŽÍVÁ JI TÝDENNÍ I ROČNÍ PŘEHLED)

   Tenhle soubor umí vykreslit data jako stromovou tabulku:
   Obal (SAP ID) -> Projekt -> Materiál, s tlačítky na sbalení/
   rozbalení jednotlivých úrovní a se sloupci za jednotlivá
   období (týdny/měsíce). Je to jeden sdílený "engine" pro
   záložky "Týdenní přehled" i "Roční přehled" - obě jen zavolají
   renderPivotTableById/renderPivotTable s jinými daty.
========================================================= */
import { $, formatNumber, pivotTableData, needsToggles, tableStates, tableFilters, hoverState, selectionState } from "./zaklad.js";
import { applyHoverHighlight, applySelectionHighlight, clearAllHover } from "./highlight.js";
import { openTextFilterPopover, getVisibleCategoryText, getVisibleDisponentText, rowPassesTextFilter } from "./filters.js";

export function setTableCollapseState(tableId, mode) {
  const state = tableStates[tableId];
  if (!state) return;

  if (mode === "sap") {
    state.collapsedSap = new Set(state.allSapKeys);
    state.collapsedProject = new Set(state.allProjectKeys);
  } else if (mode === "project") {
    state.collapsedSap = new Set();
    state.collapsedProject = new Set(state.allProjectKeys);
  } else if (mode === "material") {
    state.collapsedSap = new Set();
    state.collapsedProject = new Set();
  }

  renderPivotTableById(tableId);
}

export function openColumnsFilterPopover(tableId, anchorEl) {
  const periods = pivotTableData[tableId]?.periods || [];
  const flatRows = periods.map(p => ({ period: p }));

  openTextFilterPopover({
    tableId,
    anchorEl,
    flatRows,
    noteText: "Tip: vyber, která období (sloupce) se mají zobrazit.",
    selectedKey: "periodsSelected",
    extractor: (row) => row.period,
    onApply: () => renderPivotTableById(tableId)
  });
}

export function renderPivotTableById(tableId) {
  const data = pivotTableData[tableId];
  if (!data) return;
  renderPivotTable(tableId, data.periods, data.rows, data.extraColumns);
  applySelectionHighlight(tableId);
}

/**
 * extraColumns (volitelné): statické sloupce navíc, které nejsou vázané na
 * období (např. Budget - Peak, Peak cena...). Zobrazí se jen na SAP řádku
 * (Projekt/Materiál mají v nich prázdno), hodnotu spočítá volající přes
 * col.compute(sapRows) ze všech syrových řádků patřících danému SAP ID.
 * Tvar: { key, label, money?: boolean, compute(sapRows) => number|null }.
 */
export function renderPivotTable(tableId, periods, rows, extraColumns = []) {
  pivotTableData[tableId] = { periods, rows, extraColumns };
  const table = $(tableId);
  if (!table) return;

  const state = tableStates[tableId];
  const thead = table.tHead || table.createTHead();
  const tbody = table.tBodies[0] || table.createTBody();
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const showNeedsMaterial = !!needsToggles[tableId].material;
  const showNeedsPackaging = !!needsToggles[tableId].packaging;
  const showPoolSim = !!needsToggles[tableId].poolSim;

  const periodsSelected = tableFilters[tableId]?.periodsSelected;
  const periodsSet = periodsSelected ? new Set(periodsSelected) : null;
  const visiblePeriods = periodsSet ? periods.filter(p => periodsSet.has(p)) : periods;

  const displayColumns = [];
  for (const p of visiblePeriods) {
    displayColumns.push({ period: p, metric: "PckPoolBalance", key: `${p}__PckPoolBalance`, label: p });
    if (showPoolSim) displayColumns.push({ period: p, metric: "PckPoolBalanceSim", key: `${p}__PckPoolBalanceSim`, label: `${p} (Simulace Poolu)` });
    if (showNeedsMaterial) displayColumns.push({ period: p, metric: "requirement_qty", key: `${p}__requirement_qty`, label: `${p} (Potřeby - materiál)` });
    if (showNeedsPackaging) displayColumns.push({ period: p, metric: "RequiredPackagingQty", key: `${p}__RequiredPackagingQty`, label: `${p} (Potřeby - obaly)` });
  }

  const hierarchy = new Map();

  for (const r of rows) {
    const sap = String(r.SAP_ID || "");
    const project = String(r.Project || "");
    const disponent = String(r.Disponent || "");

    let sapNode = hierarchy.get(sap);
    if (!sapNode) {
      sapNode = { disponent: disponent, total: {}, projects: new Map(), allRows: [] };
      hierarchy.set(sap, sapNode);
    }
    if (!sapNode.disponent && disponent) sapNode.disponent = disponent;
    sapNode.allRows.push(r);

    let projectNode = sapNode.projects.get(project);
    if (!projectNode) {
      projectNode = { total: {}, materials: [] };
      sapNode.projects.set(project, projectNode);
    }
    projectNode.materials.push(r);

    for (const col of displayColumns) {
      if (col.metric === "PckPoolBalance" || col.metric === "PckPoolBalanceSim") {
        // NULL = pro tenhle materiál/období není žádná hodnota (ne že by
        // pool byl 0) - do minima se nepočítá, jinak by "chybí data"
        // uměle stahovalo minimum na 0 i když jsou jinde v projektu
        // reálná čísla (např. 80000).
        const raw = r[col.key];
        if (raw === null || raw === undefined) continue;
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;

        projectNode.total[col.key] = projectNode.total[col.key] === undefined
          ? value
          : Math.min(projectNode.total[col.key], value);
      } else {
        const value = Number(r[col.key] ?? 0);
        projectNode.total[col.key] = (projectNode.total[col.key] || 0) + value;
      }
    }
  }

  for (const [, sapNode] of hierarchy.entries()) {
    for (const [, projectNode] of sapNode.projects.entries()) {
      for (const col of displayColumns) {
        if (col.metric === "PckPoolBalance" || col.metric === "PckPoolBalanceSim") {
          // Stejná konvence jako u Materiál -> Projekt výš: SAP balance je
          // minimum z jeho projektů, ne součet - projekt bez dat (undefined)
          // se do minima nepočítá.
          const value = projectNode.total[col.key];
          if (value === undefined) continue;

          sapNode.total[col.key] = sapNode.total[col.key] === undefined
            ? value
            : Math.min(sapNode.total[col.key], value);
        } else {
          const value = Number(projectNode.total[col.key] ?? 0);
          sapNode.total[col.key] = (sapNode.total[col.key] || 0) + value;
        }
      }
    }
  }

  if (!state.initialized) {
    state.initialized = true;
    state.allSapKeys = [...hierarchy.keys()].map(sap => `sap||${sap}`);
    state.allProjectKeys = [];
    for (const [sap, sapNode] of hierarchy.entries()) {
      for (const project of sapNode.projects.keys()) {
        state.allProjectKeys.push(`project||${sap}||${project}`);
      }
    }
    state.collapsedSap = new Set(state.allSapKeys);
    state.collapsedProject = new Set(state.allProjectKeys);
  }

  const sapKeys = [...hierarchy.keys()].sort((a, b) => a.localeCompare(b, "cs"));
  const flatRows = [];

  for (const sap of sapKeys) {
    const sapNode = hierarchy.get(sap);

    const extraValues = {};
    for (const col of extraColumns) extraValues[col.key] = col.compute(sapNode.allRows);

    flatRows.push({
      level: "sap",
      sap,
      project: "",
      disponent: sapNode.disponent || "",
      material: "",
      values: sapNode.total,
      extraValues,
      key: `sap||${sap}`,
      parentKey: null
    });

    const projectKeys = [...sapNode.projects.keys()].sort((a, b) => a.localeCompare(b, "cs"));
    for (const project of projectKeys) {
      const projectNode = sapNode.projects.get(project);
      flatRows.push({
        level: "project",
        sap,
        project,
        disponent: "",
        material: "",
        values: projectNode.total,
        key: `project||${sap}||${project}`,
        parentKey: `sap||${sap}`
      });

      const materialRows = projectNode.materials.slice().sort((a, b) =>
        String(a.local_material || "").localeCompare(String(b.local_material || ""), "cs")
      );

      for (const r of materialRows) {
        flatRows.push({
          level: "material",
          sap,
          project,
          disponent: "",
          material: String(r.local_material || ""),
          values: r,
          key: `material||${sap}||${project}||${r.local_material}`,
          parentKey: `project||${sap}||${project}`
        });
      }
    }
  }

  const selectedCat = tableFilters[tableId]?.categorySelected;
  const selectedDisp = tableFilters[tableId]?.disponentSelected;
  const selectedCatSet = selectedCat ? new Set(selectedCat) : null;
  const selectedDispSet = selectedDisp ? new Set(selectedDisp) : null;

  // Kategorie/Disponent filtr se vyhodnocuje jen podle textu na úrovni
  // SAP ID (Obal) - Projekt/Materiál mají jiný text (u Disponenta
  // dokonce žádný), takže kdyby se filtrovalo po jejich vlastním textu,
  // po rozbalení SAP řádku by se žádný potomek nikdy nezobrazil. Když
  // SAP ID filtrem projde, zobrazí se (po rozbalení) všichni jeho
  // Projekty/Materiály bez ohledu na jejich vlastní text.
  const sapFilterPass = new Map();
  for (const row of flatRows) {
    if (row.level !== "sap") continue;
    sapFilterPass.set(row.sap,
      rowPassesTextFilter(row, selectedCatSet, getVisibleCategoryText) &&
      rowPassesTextFilter(row, selectedDispSet, getVisibleDisponentText)
    );
  }

  function rowIsHidden(row) {
    const hiddenByCollapse =
      (row.level === "project" && state.collapsedSap.has(row.parentKey)) ||
      (row.level === "material" && (state.collapsedSap.has(`sap||${row.sap}`) || state.collapsedProject.has(row.parentKey)));

    if (hiddenByCollapse) return true;

    return !sapFilterPass.get(row.sap);
  }

  const headerRow = document.createElement("tr");

  const thCat = document.createElement("th");
  thCat.className = "category-cell";
  const thCatFlex = document.createElement("div");
  thCatFlex.className = "th-flex";
  const thCatTitle = document.createElement("span");
  thCatTitle.textContent = "Kategorie";
  const filterCatBtn = document.createElement("button");
  filterCatBtn.className = "filter-btn";
  filterCatBtn.type = "button";
  filterCatBtn.title = "Filtrovat kategorii";
  filterCatBtn.textContent = "▾";
  filterCatBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openTextFilterPopover({
      tableId,
      anchorEl: filterCatBtn,
      flatRows: flatRows.filter(r => r.level === "sap"),
      noteText: "Tip: filtruje se podle SAP ID (Obal) - vybrané SAP ID se po rozbalení zobrazí i s Projekty/Materiály.",
      selectedKey: "categorySelected",
      extractor: getVisibleCategoryText,
      onApply: () => renderPivotTableById(tableId)
    });
  });
  thCatFlex.append(thCatTitle, filterCatBtn);
  thCat.appendChild(thCatFlex);
  headerRow.appendChild(thCat);

  const thDisp = document.createElement("th");
  thDisp.className = "disponent-cell";
  const thDispFlex = document.createElement("div");
  thDispFlex.className = "th-flex";
  const thDispTitle = document.createElement("span");
  thDispTitle.textContent = "Disponent";
  const filterDispBtn = document.createElement("button");
  filterDispBtn.className = "filter-btn";
  filterDispBtn.type = "button";
  filterDispBtn.title = "Filtrovat disponenta";
  filterDispBtn.textContent = "▾";
  filterDispBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openTextFilterPopover({
      tableId,
      anchorEl: filterDispBtn,
      flatRows,
      noteText: "Tip: filtruje se podle textu ve sloupci Disponent.",
      selectedKey: "disponentSelected",
      extractor: getVisibleDisponentText,
      onApply: () => renderPivotTableById(tableId)
    });
  });
  thDispFlex.append(thDispTitle, filterDispBtn);
  thDisp.appendChild(thDispFlex);
  headerRow.appendChild(thDisp);

  for (const col of extraColumns) {
    const th = document.createElement("th");
    th.className = "value-cell col-summary";
    th.textContent = col.label;
    headerRow.appendChild(th);
  }

  for (const col of displayColumns) {
    const th = document.createElement("th");
    th.className = "value-cell";
    if (col.metric === "requirement_qty") th.classList.add("col-material");
    if (col.metric === "RequiredPackagingQty") th.classList.add("col-packaging");
    if (col.metric === "PckPoolBalanceSim") th.classList.add("col-poolSim");
    th.textContent = col.label;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  function rowValueClass(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "zero";
    if (n > 0) return "pos";
    return "neg";
  }

  const frag = document.createDocumentFragment();

  for (const row of flatRows) {
    if (rowIsHidden(row)) continue;

    const tr = document.createElement("tr");
    tr.className = row.level === "sap" ? "level-sap" : row.level === "project" ? "level-project" : "level-material";
    tr.dataset.rowKey = row.key;
    tr.dataset.level = row.level;

    const tdCategory = document.createElement("td");
    tdCategory.className = "category-cell";

    const flex = document.createElement("div");
    flex.className = "row-flex";

    if (row.level === "sap") {
      const btn = document.createElement("button");
      btn.className = "toggle-btn";
      const isCollapsed = state.collapsedSap.has(row.key);
      btn.textContent = isCollapsed ? "+" : "−";
      btn.dataset.toggle = "sap";
      btn.dataset.key = row.key;
      flex.appendChild(btn);

      const badge = document.createElement("span");
      badge.className = "level-badge badge-sap";
      badge.textContent = "Obal";

      const text = document.createElement("span");
      text.className = "row-label indent-sap";
      text.textContent = row.sap;

      flex.append(badge, text);
    } else if (row.level === "project") {
      const btn = document.createElement("button");
      btn.className = "toggle-btn";
      const isCollapsed = state.collapsedProject.has(row.key);
      btn.textContent = isCollapsed ? "+" : "−";
      btn.dataset.toggle = "project";
      btn.dataset.key = row.key;
      flex.appendChild(btn);

      const badge = document.createElement("span");
      badge.className = "level-badge badge-project";
      badge.textContent = "Projekt";

      const text = document.createElement("span");
      text.className = "row-label indent-project";
      text.textContent = row.project;

      flex.append(badge, text);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "toggle-spacer";
      flex.appendChild(spacer);

      const badge = document.createElement("span");
      badge.className = "level-badge badge-material";
      badge.textContent = "Materiál";

      const text = document.createElement("span");
      text.className = "row-label indent-material";
      text.textContent = row.material;

      flex.append(badge, text);
    }

    tdCategory.appendChild(flex);
    tr.appendChild(tdCategory);

    const tdDisp = document.createElement("td");
    tdDisp.className = "disponent-cell";
    tdDisp.textContent = row.level === "sap" ? (row.disponent || "") : "";
    tr.appendChild(tdDisp);

    for (let extraIndex = 0; extraIndex < extraColumns.length; extraIndex++) {
      const col = extraColumns[extraIndex];
      const td = document.createElement("td");
      td.className = "num value-cell col-summary";
      td.dataset.colIndex = String(extraIndex + 2);

      const rawValue = row.extraValues ? row.extraValues[col.key] : null;
      if (rawValue === null || rawValue === undefined) {
        td.textContent = "";
      } else {
        const value = Number(rawValue);
        td.classList.add(rowValueClass(value));
        td.textContent = col.format ? col.format(value) : formatNumber(value);
        td.dataset.cellKey = `${row.key}||extra||${col.key}`;
      }

      tr.appendChild(td);
    }

    for (let colIndex = 0; colIndex < displayColumns.length; colIndex++) {
      const col = displayColumns[colIndex];
      const td = document.createElement("td");
      td.className = "num value-cell";
      td.dataset.colIndex = String(colIndex + 2 + extraColumns.length);

      if (col.metric === "requirement_qty") td.classList.add("col-material");
      if (col.metric === "RequiredPackagingQty") td.classList.add("col-packaging");
      if (col.metric === "PckPoolBalanceSim") td.classList.add("col-poolSim");

      const rawValue = row.values[col.key];
      const isPoolMetric = col.metric === "PckPoolBalance" || col.metric === "PckPoolBalanceSim";

      if (isPoolMetric && (rawValue === null || rawValue === undefined)) {
        // Žádná data pro tenhle řádek/období - nezaměňovat s opravdovou 0.
        td.textContent = "";
      } else {
        const value = Number(rawValue ?? 0);
        if (col.metric === "PckPoolBalance") td.classList.add(rowValueClass(value));
        td.textContent = formatNumber(value);
      }

      const cellKey = `${row.key}||${col.key}`;
      td.dataset.cellKey = cellKey;

      tr.appendChild(td);
    }

    frag.appendChild(tr);
  }

  tbody.appendChild(frag);

  if (!table.__delegationBound) {
    table.__delegationBound = true;

    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button.toggle-btn");
      if (btn) {
        const key = btn.dataset.key;
        const type = btn.dataset.toggle;
        if (type === "sap") {
          if (state.collapsedSap.has(key)) state.collapsedSap.delete(key);
          else state.collapsedSap.add(key);
        } else if (type === "project") {
          if (state.collapsedProject.has(key)) state.collapsedProject.delete(key);
          else state.collapsedProject.add(key);
        }
        renderPivotTableById(tableId);
        return;
      }

      const td = e.target.closest("td");
      if (!td) return;
      const tr = td.parentElement;
      if (!tr) return;

      const cellKey = td.dataset.cellKey;
      const colIndex = Number(td.dataset.colIndex);
      const rowKey = tr.dataset.rowKey;

      if (!cellKey || !Number.isFinite(colIndex) || !rowKey) return;

      const selstate = selectionState[tableId];
      const alreadySelected =
        selstate.cellKey === cellKey &&
        selstate.rowKey === rowKey &&
        selstate.colIndex === colIndex;

      if (alreadySelected) {
        selstate.rowKey = null;
        selstate.colIndex = null;
        selstate.cellKey = null;
      } else {
        selstate.rowKey = rowKey;
        selstate.colIndex = colIndex;
        selstate.cellKey = cellKey;
      }

      renderPivotTableById(tableId);
    });

    tbody.addEventListener("mousemove", (e) => {
      const td = e.target.closest("td");
      if (!td) return;
      const tr = td.parentElement;
      if (!tr) return;

      const cellKey = td.dataset.cellKey;
      const colIndex = Number(td.dataset.colIndex);
      const rowKey = tr.dataset.rowKey;

      if (!cellKey || !Number.isFinite(colIndex) || !rowKey) return;
      if (hoverState.tableId === tableId && hoverState.cellKey === cellKey) return;

      applyHoverHighlight(tableId, rowKey, colIndex, cellKey);
    }, { passive: true });

    tbody.addEventListener("mouseleave", () => {
      clearAllHover();
      applySelectionHighlight(tableId);
    }, { passive: true });
  }

  applySelectionHighlight(tableId);
}
