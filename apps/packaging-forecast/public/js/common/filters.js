/* =========================================================
   FILTR U SLOUPCŮ "KATEGORIE" A "DISPONENT"

   Okénko (popover), které se otevře po kliknutí na šipku ▾ u
   hlavičky sloupce ve stromové tabulce - jde v něm vyhledat a
   zaškrtnout, které hodnoty se mají v tabulce zobrazovat.
   Používá ho common/pivotTable.js.
========================================================= */
import { tableFilters, filterPopoverState } from "./zaklad.js";

export function closeAnyFilterPopover() {
  if (filterPopoverState.current) {
    filterPopoverState.current.classList.remove("open");
    filterPopoverState.current.remove();
    filterPopoverState.current = null;
  }
}

document.addEventListener("click", (e) => {
  if (filterPopoverState.current && !filterPopoverState.current.contains(e.target)) {
    closeAnyFilterPopover();
  }
});

export function getVisibleCategoryText(row) {
  if (row.level === "sap") return row.sap;
  if (row.level === "project") return row.project;
  return row.material;
}

export function getVisibleDisponentText(row) {
  if (row.level === "sap") return row.disponent || "";
  return "";
}

export function buildUniverse(flatRows, extractor) {
  const set = new Set();
  for (const r of flatRows) {
    const t = String(extractor(r) ?? "").trim();
    if (t) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "cs"));
}

export function rowPassesTextFilter(row, selectedSet, extractor) {
  if (!selectedSet || selectedSet.size === 0) return true;
  const t = String(extractor(row) ?? "").trim();
  return selectedSet.has(t);
}

export function openTextFilterPopover({ tableId, anchorEl, flatRows, noteText, selectedKey, extractor, onApply }) {
  closeAnyFilterPopover();

  const universe = buildUniverse(flatRows, extractor);
  const current = tableFilters[tableId]?.[selectedKey];
  const selected = current ? new Set(current) : new Set(universe);

  const pop = document.createElement("div");
  pop.className = "filter-popover open";

  const head = document.createElement("div");
  head.className = "filter-head";

  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Hledat...";
  head.appendChild(search);

  const actions = document.createElement("div");
  actions.className = "filter-actions";

  const btnAll = document.createElement("button");
  btnAll.className = "filter-mini-btn";
  btnAll.type = "button";
  btnAll.textContent = "Vybrat vše";
  btnAll.onclick = () => {
    selected.clear();
    universe.forEach(v => selected.add(v));
    renderList();
  };

  const btnNone = document.createElement("button");
  btnNone.className = "filter-mini-btn";
  btnNone.type = "button";
  btnNone.textContent = "Zrušit vše";
  btnNone.onclick = () => {
    selected.clear();
    renderList();
  };

  const btnApply = document.createElement("button");
  btnApply.className = "filter-mini-btn primary";
  btnApply.type = "button";
  btnApply.textContent = "Použít";
  btnApply.onclick = () => {
    const allSelected = selected.size === universe.length;
    tableFilters[tableId][selectedKey] = allSelected ? null : [...selected];
    closeAnyFilterPopover();
    onApply();
  };

  const btnClear = document.createElement("button");
  btnClear.className = "filter-mini-btn";
  btnClear.type = "button";
  btnClear.textContent = "Vymazat filtr";
  btnClear.onclick = () => {
    tableFilters[tableId][selectedKey] = null;
    closeAnyFilterPopover();
    onApply();
  };

  actions.append(btnAll, btnNone, btnApply, btnClear);
  head.appendChild(actions);

  const note = document.createElement("div");
  note.className = "filter-note";
  note.textContent = noteText;
  head.appendChild(note);

  const list = document.createElement("div");
  list.className = "filter-list";

  pop.appendChild(head);
  pop.appendChild(list);
  document.body.appendChild(pop);

  function renderList() {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = "";
    const filtered = universe.filter(v => v.toLowerCase().includes(q));
    const frag = document.createDocumentFragment();
    for (const v of filtered) {
      const item = document.createElement("label");
      item.className = "filter-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(v);
      cb.onchange = () => {
        if (cb.checked) selected.add(v);
        else selected.delete(v);
      };

      const span = document.createElement("span");
      span.textContent = v;
      item.append(cb, span);
      frag.appendChild(item);
    }
    list.appendChild(frag);
  }

  search.addEventListener("input", renderList, { passive: true });
  renderList();

  const r = anchorEl.getBoundingClientRect();
  pop.style.top = `${Math.min(window.innerHeight - 20, r.bottom + 6)}px`;
  pop.style.left = `${Math.min(window.innerWidth - 20, Math.max(10, r.left - 240))}px`;

  filterPopoverState.current = pop;
}
