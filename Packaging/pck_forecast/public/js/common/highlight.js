/* =========================================================
   ZVÝRAZNĚNÍ ŘÁDKU/SLOUPCE/BUŇKY MYŠÍ

   Když najedeš myší (nebo klikneš) na buňku ve stromové tabulce,
   tenhle soubor se stará o to, aby se zvýraznil celý řádek, celý
   sloupec i konkrétní buňka - pomáhá to při čtení velké tabulky.
   Používá ho common/pivotTable.js.
========================================================= */
import { $, hoverState, selectionState } from "./zaklad.js";

export function clearAllHover() {
  hoverState.tableId = null;
  hoverState.rowKey = null;
  hoverState.colIndex = null;
  hoverState.cellKey = null;

  document.querySelectorAll(".hover-row, .hover-col, .hover-cell").forEach(el => {
    el.classList.remove("hover-row", "hover-col", "hover-cell");
  });
}

export function applyHoverHighlight(tableId, rowKey, colIndex, cellKey) {
  const table = $(tableId);
  if (!table) return;

  clearAllHover();
  hoverState.tableId = tableId;
  hoverState.rowKey = rowKey;
  hoverState.colIndex = colIndex;
  hoverState.cellKey = cellKey;

  const tbody = table.tBodies[0];
  if (!tbody) return;

  if (rowKey) {
    const tr = tbody.querySelector(`tr[data-row-key="${CSS.escape(rowKey)}"]`);
    if (tr) tr.classList.add("hover-row");
  }

  if (typeof colIndex === "number") {
    for (const tr of tbody.rows) {
      const cell = tr.cells[colIndex];
      if (cell) cell.classList.add("hover-col");
    }
  }

  if (cellKey) {
    const cell = table.querySelector(`[data-cell-key="${CSS.escape(cellKey)}"]`);
    if (cell) cell.classList.add("hover-cell");
  }
}

export function applySelectionHighlight(tableId) {
  const state = selectionState[tableId];
  const table = $(tableId);
  if (!table) return;

  table.querySelectorAll(".selected-row, .selected-col, .selected-cell").forEach(el => {
    el.classList.remove("selected-row", "selected-col", "selected-cell");
  });

  const tbody = table.tBodies[0];
  if (!tbody) return;

  if (state.rowKey) {
    const tr = tbody.querySelector(`tr[data-row-key="${CSS.escape(state.rowKey)}"]`);
    if (tr) tr.classList.add("selected-row");
  }

  if (state.cellKey) {
    const cell = table.querySelector(`[data-cell-key="${CSS.escape(state.cellKey)}"]`);
    if (cell) cell.classList.add("selected-cell");
  }

  if (typeof state.colIndex === "number") {
    for (const tr of tbody.rows) {
      const cell = tr.cells[state.colIndex];
      if (cell) cell.classList.add("selected-col");
    }
  }
}
