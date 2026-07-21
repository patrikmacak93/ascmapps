/**
 * PCK – Database Search
 * Statická stránka, žádný build. Načtěte přes:
 *   <script src="./pck-table-search.js" defer></script>
 *
 * Funkce:
 *   - označování řádků (checkbox, výběr přežije stránkování i filtry)
 *   - řazení kliknutím na hlavičku (asc / desc / bez řazení)
 *   - zmrazené sloupce vlevo
 *   - filtry po sloupcích + globální hledání + zrušení všech filtrů
 *   - výběr viditelných sloupců (localStorage)
 *   - detail řádku v bočním panelu, včetně kopírování hodnot
 *   - stav (filtry, řazení, stránka) v URL
 *   - export označených / filtrovaných řádků do XLSX nebo CSV
 *   - zkratky: ← → stránkování, "/" hledání, Esc zavření panelu
 */
(function () {
  "use strict";

  // ===========================================================================
  // Konfigurace
  // ===========================================================================

  // Adresa API je v pck-config.js (načítá se před tímhle skriptem).
  // Dřív: https://fsas00025vma.vt1.vitesco.com:1884/search_pckDtb
  const API_BASE = (window.PCK_CONFIG && window.PCK_CONFIG.API_BASE) || "./api";
  const DATA_URL = API_BASE + "/pck-database";
  const STORAGE_KEY = "pckDtbSearch.settings.v1";

  const SELECT_COL = "Select";   // technický sloupec s checkboxem
  const ACTIONS_COL = "Actions"; // technický sloupec s tlačítky

  /** Sloupce ukotvené vlevo (v tomto pořadí, pokud v datech existují). */
  const STICKY_COLUMNS = [SELECT_COL, ACTIONS_COL, "ID", "Project", "Part Number"];

  /** Sloupce, které se nedají skrýt ani řadit. */
  const SYSTEM_COLUMNS = new Set([SELECT_COL, ACTIONS_COL]);

  /**
   * Kategorie v detailu záznamu. Pravidla se vyhodnocují shora dolů,
   * první shoda vyhrává – proto je I-pack před P-packem (např.
   * "QTY of I-pack in P-pack" patří k vnitřnímu balení).
   */
  const DETAIL_GROUPS = [
    {
      title: "General",
      fields: [
        "ID", "Project", "Part Number", "Part Name", "Part Weight", "Usage",
        "Supplier / Customer", "Part type", "Concept Status", "PSDS",
      ],
    },
    {
      title: "Loading unit",
      // stohování na paletě – rozhodnuto dřív, než se uplatní pravidlo P-pack
      fields: [
        "QTY of P-packs in layer on pallet",
        "QTY of layers /pallet",
        "QTY of P-pack lids /pallet",
      ],
      match: (key) => key.toLowerCase().includes("pallet"),
    },
    {
      title: "Inner packaging",
      match: (key) => key.toLowerCase().includes("i-pack"),
    },
    {
      title: "Primary packaging",
      match: (key) => key.toLowerCase().includes("p-pack"),
    },
    {
      title: "Ostatní",
      match: () => true,
    },
  ];

  /** Pole, která zaberou v detailu celou šířku (dlouhý text / odkaz). */
  const DETAIL_WIDE_FIELDS = new Set([
    "Part Name",
    "Description of add I-packs inside P-pack",
    "PSDS",
    "Supplier / Customer",
    "P-pack name",
    "I-pack name",
    "Pallet name",
    "P-pack lid name",
    "Pallet lid name",
  ]);

  const FILTER_DEBOUNCE_MS = 160;

  const ICON_COPY =
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
    '<rect x="5.5" y="5.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M10.5 3.5V2.7A1.2 1.2 0 0 0 9.3 1.5H2.7A1.2 1.2 0 0 0 1.5 2.7v6.6a1.2 1.2 0 0 0 1.2 1.2h.8" ' +
    'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

  const ICON_CHECK =
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
    '<path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ===========================================================================
  // Stav
  // ===========================================================================

  const state = {
    allTableData: [],
    searchIndex: [],
    filteredData: [],
    tableHeaders: [],
    hiddenColumns: new Set(),
    selected: new Set(),        // __index označených řádků
    columnFilters: {},
    globalQuery: "",
    sort: { column: null, direction: null },
    currentPage: 1,
    itemsPerPage: 20,
    detailIndex: null,          // právě otevřený detail
    loadedAt: null,
  };

  const dom = {};
  let eventsBound = false;
  let filterTimer = null;
  let urlTimer = null;

  // ===========================================================================
  // Pomocné funkce
  // ===========================================================================

  const escapeHtml = (text) =>
    String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const dataHeaders = () =>
    state.tableHeaders.filter((h) => !SYSTEM_COLUMNS.has(h));

  const visibleHeaders = () =>
    state.tableHeaders.filter((h) => !state.hiddenColumns.has(h));

  const getTotalPages = () =>
    Math.max(1, Math.ceil(state.filteredData.length / state.itemsPerPage));

  const getCurrentPageData = () => {
    const start = (state.currentPage - 1) * state.itemsPerPage;
    return state.filteredData.slice(start, start + state.itemsPerPage);
  };

  const activeFilterCount = () =>
    Object.values(state.columnFilters).filter((v) => (v || "").trim() !== "").length +
    (state.globalQuery.trim() ? 1 : 0);

  function toNumber(value) {
    if (value == null || value === "") return null;
    const normalized = String(value).replace(",", ".").trim();
    return /^-?\d+(\.\d+)?$/.test(normalized) ? parseFloat(normalized) : null;
  }

  /** Zkopíruje text do schránky a krátce potvrdí na tlačítku. */
  async function copyToClipboard(text, button) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // fallback pro http:// (např. lokální náhled)
        const helper = document.createElement("textarea");
        helper.value = text;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        helper.remove();
      }

      if (button) {
        const original = button.innerHTML;
        button.innerHTML = ICON_CHECK;
        button.classList.add("is-copied");
        setTimeout(() => {
          button.innerHTML = original;
          button.classList.remove("is-copied");
        }, 1200);
      }
    } catch (e) {
      console.error("pckDtbSearch: kopírování selhalo", e);
      alert("Zkopírovat se nepodařilo. Zkuste hodnotu označit a použít Ctrl+C.");
    }
  }

  // ===========================================================================
  // Nastavení
  // ===========================================================================

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (saved.itemsPerPage > 0) state.itemsPerPage = saved.itemsPerPage;
      if (Array.isArray(saved.hiddenColumns)) {
        state.hiddenColumns = new Set(saved.hiddenColumns);
      }
    } catch (e) {
      console.warn("pckDtbSearch: nastavení nelze načíst", e);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        itemsPerPage: state.itemsPerPage,
        hiddenColumns: [...state.hiddenColumns],
      }));
    } catch (e) { /* soukromý režim – ignorujeme */ }
  }

  // ===========================================================================
  // Stav v URL
  // ===========================================================================

  function readStateFromUrl() {
    const params = new URLSearchParams(window.location.search);

    state.globalQuery = params.get("q") || "";

    const sortCol = params.get("sort");
    const sortDir = params.get("dir");
    if (sortCol && (sortDir === "asc" || sortDir === "desc")) {
      state.sort = { column: sortCol, direction: sortDir };
    }

    const page = parseInt(params.get("page"), 10);
    if (page > 0) state.currentPage = page;

    params.forEach((value, key) => {
      if (key.startsWith("f.") && value) state.columnFilters[key.slice(2)] = value;
    });
  }

  function writeStateToUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      const params = new URLSearchParams();

      if (state.globalQuery.trim()) params.set("q", state.globalQuery.trim());
      if (state.sort.column) {
        params.set("sort", state.sort.column);
        params.set("dir", state.sort.direction);
      }
      if (state.currentPage > 1) params.set("page", String(state.currentPage));

      Object.entries(state.columnFilters).forEach(([col, value]) => {
        if ((value || "").trim()) params.set("f." + col, value.trim());
      });

      const query = params.toString();
      history.replaceState(null, "", query ? "?" + query : window.location.pathname);
    }, 300);
  }

  // ===========================================================================
  // Formátování buněk
  // ===========================================================================

  function formatCellValue(value, key) {
    if (value == null || value === "") return "";

    // Actions skládá buildActionsHtml() z už escapovaného ID — hotové HTML.
    if (key === ACTIONS_COL) return String(value);

    const text = String(value);
    const safe = escapeHtml(text);

    if (text.startsWith("https")) {
      if (key === "PSDS") {
        return '<button type="button" class="psds-button" data-url="' + safe +
               '">PSDS</button>';
      }
      const filename = escapeHtml(text.split("/").pop() || text);
      return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' +
             filename + "</a>";
    }

    return safe;
  }

  // ===========================================================================
  // Zmrazené sloupce
  // ===========================================================================

  function stickyOrder() {
    return STICKY_COLUMNS.filter(
      (col) => state.tableHeaders.includes(col) && !state.hiddenColumns.has(col)
    );
  }

  function applyStickyOffsets() {
    const sticky = stickyOrder();
    if (!sticky.length) return;

    const headers = visibleHeaders();
    const headerCells = [...dom.headerRow.children];
    const bodyRows = [...dom.body.querySelectorAll("tr")];
    let offset = 0;

    sticky.forEach((col, i) => {
      const index = headers.indexOf(col);
      if (index === -1 || !headerCells[index]) return;

      const isLast = i === sticky.length - 1;
      const left = offset + "px";

      const setCell = (cell) => {
        if (!cell) return;
        cell.classList.add("pck-sticky-col");
        cell.classList.toggle("pck-sticky-last", isLast);
        cell.style.left = left;
      };

      setCell(headerCells[index]);
      setCell(dom.filterRow.children[index]);
      bodyRows.forEach((tr) => setCell(tr.children[index]));

      offset += headerCells[index].getBoundingClientRect().width;
    });
  }

  // ===========================================================================
  // Vykreslení tabulky
  // ===========================================================================

  function renderHeaders() {
    const headerFrag = document.createDocumentFragment();
    const filterFrag = document.createDocumentFragment();

    visibleHeaders().forEach((columnKey) => {
      const th = document.createElement("th");
      th.dataset.column = columnKey;

      if (columnKey === SELECT_COL) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.id = "pck-select-all";
        box.className = "pck-select";
        box.setAttribute("aria-label", "Označit všechny filtrované řádky");
        th.appendChild(box);
      } else if (columnKey === ACTIONS_COL) {
        th.textContent = columnKey;
      } else {
        const isSorted = state.sort.column === columnKey;
        const arrow = !isSorted ? "↕" : state.sort.direction === "asc" ? "↑" : "↓";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pck-sort-btn" + (isSorted ? " is-sorted" : "");
        btn.dataset.column = columnKey;
        btn.innerHTML =
          '<span class="pck-th-label">' + escapeHtml(columnKey) + "</span>" +
          '<span class="pck-sort-arrow" aria-hidden="true">' + arrow + "</span>";
        btn.setAttribute("aria-label", "Seřadit podle " + columnKey);
        th.appendChild(btn);
      }

      headerFrag.appendChild(th);

      const filterTh = document.createElement("th");
      if (!SYSTEM_COLUMNS.has(columnKey)) {
        const input = document.createElement("input");
        input.type = "search";
        input.className = "pck-filter-input";
        input.dataset.column = columnKey;
        input.value = state.columnFilters[columnKey] || "";
        input.setAttribute("aria-label", "Filtrovat sloupec " + columnKey);
        filterTh.appendChild(input);
      }
      filterFrag.appendChild(filterTh);
    });

    dom.headerRow.replaceChildren(headerFrag);
    dom.filterRow.replaceChildren(filterFrag);
    syncSelectAllCheckbox();
  }

  function renderTableBody() {
    const headers = visibleHeaders();
    const rows = getCurrentPageData();

    if (!rows.length) {
      showMessage(
        state.allTableData.length
          ? "Žádný řádek neodpovídá filtru. Zrušte filtry a zkuste to znovu."
          : "Žádná data."
      );
      return;
    }

    const frag = document.createDocumentFragment();

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.rowIndex = row.__index;
      if (state.selected.has(row.__index)) tr.classList.add("is-selected");

      headers.forEach((columnKey) => {
        const td = document.createElement("td");

        if (columnKey === SELECT_COL) {
          const box = document.createElement("input");
          box.type = "checkbox";
          box.className = "pck-select";
          box.checked = state.selected.has(row.__index);
          box.dataset.rowIndex = row.__index;
          box.setAttribute("aria-label", "Označit řádek");
          td.appendChild(box);
        } else {
          td.innerHTML = formatCellValue(row[columnKey], columnKey);
          if (columnKey !== ACTIONS_COL) td.dataset.field = columnKey;
          if (state.sort.column === columnKey) td.classList.add("is-sorted");
        }

        tr.appendChild(td);
      });

      frag.appendChild(tr);
    });

    dom.body.replaceChildren(frag);
    requestAnimationFrame(applyStickyOffsets);
  }

  /** Hlavičkový checkbox: zaškrtnutý / částečný / prázdný. */
  function syncSelectAllCheckbox() {
    const box = document.getElementById("pck-select-all");
    if (!box) return;

    const total = state.filteredData.length;
    const selected = state.filteredData.filter((r) => state.selected.has(r.__index)).length;

    box.checked = total > 0 && selected === total;
    box.indeterminate = selected > 0 && selected < total;
  }

  function renderToolbar() {
    const filters = activeFilterCount();
    dom.clearBtn.hidden = filters === 0;
    dom.clearBtn.textContent =
      filters === 0 ? "Zrušit filtry" : "Zrušit filtry (" + filters + ")";

    const shown = visibleHeaders().filter((h) => !SYSTEM_COLUMNS.has(h)).length;
    dom.columnsBtn.textContent = "Sloupce (" + shown + "/" + dataHeaders().length + ")";

    const count = state.selected.size;

    if (dom.selectionBar && dom.selectionCount) {
      dom.selectionBar.hidden = count === 0;
      dom.selectionCount.textContent =
        count + (count === 1 ? " označený řádek" : count < 5 ? " označené řádky" : " označených řádků");
    }

    dom.exportBtn.textContent = count ? "Exportovat označené" : "Exportovat výběr";
  }

  function renderPaginationInfo() {
    dom.pageInfo.textContent =
      state.currentPage + " / " + getTotalPages() +
      " (řádků: " + state.filteredData.length.toLocaleString("cs-CZ") + ")";

    dom.prevBtn.disabled = state.currentPage <= 1;
    dom.nextBtn.disabled = state.currentPage >= getTotalPages();
  }

  function renderStatus() {
    if (!state.loadedAt) return;
    const time = state.loadedAt.toLocaleTimeString("cs-CZ", {
      hour: "2-digit",
      minute: "2-digit",
    });
    dom.status.textContent =
      "Aktualizováno " + time + " · " +
      state.allTableData.length.toLocaleString("cs-CZ") + " záznamů";
  }

  function render() {
    renderTableBody();
    renderPaginationInfo();
    renderToolbar();
    syncSelectAllCheckbox();
    writeStateToUrl();
  }

  function showMessage(text, withRetry) {
    const span = Math.max(1, visibleHeaders().length);
    const retry = withRetry
      ? ' <button type="button" id="pck-retry-btn" class="pck-btn-inline">Zkusit znovu</button>'
      : "";
    dom.body.innerHTML =
      "<tr><td colspan='" + span + "' class='pck-message'>" +
      escapeHtml(text) + retry + "</td></tr>";
  }

  // ===========================================================================
  // Filtry a řazení
  // ===========================================================================

  function buildSearchIndex() {
    state.searchIndex = state.allTableData.map((row) => {
      const cols = {};
      const parts = [];
      dataHeaders().forEach((key) => {
        const value = row[key] == null ? "" : String(row[key]).toLowerCase();
        cols[key] = value;
        if (value) parts.push(value);
      });
      return { cols, blob: parts.join(" ") };
    });
  }

  function compareRows(a, b) {
    const key = state.sort.column;
    const dir = state.sort.direction === "desc" ? -1 : 1;

    const rawA = a[key];
    const rawB = b[key];
    const emptyA = rawA == null || rawA === "";
    const emptyB = rawB == null || rawB === "";

    if (emptyA && emptyB) return 0;
    if (emptyA) return 1;
    if (emptyB) return -1;

    const numA = toNumber(rawA);
    const numB = toNumber(rawB);
    if (numA !== null && numB !== null) return (numA - numB) * dir;

    return String(rawA).localeCompare(String(rawB), "cs", {
      numeric: true,
      sensitivity: "base",
    }) * dir;
  }

  function applyFiltersAndRender(resetPage = true) {
    const filters = Object.entries(state.columnFilters)
      .map(([key, value]) => ({ key, value: (value || "").trim().toLowerCase() }))
      .filter((f) => f.value !== "");

    const query = state.globalQuery.trim().toLowerCase();

    let result = state.allTableData;

    if (filters.length || query) {
      result = state.allTableData.filter((row) => {
        const indexed = state.searchIndex[row.__index];
        if (query && !indexed.blob.includes(query)) return false;
        return filters.every((f) => (indexed.cols[f.key] || "").includes(f.value));
      });
    }

    if (state.sort.column) result = result.slice().sort(compareRows);

    state.filteredData = result;
    state.currentPage = resetPage
      ? 1
      : Math.min(state.currentPage, getTotalPages());

    render();
  }

  function toggleSort(columnKey) {
    if (state.sort.column !== columnKey) {
      state.sort = { column: columnKey, direction: "asc" };
    } else if (state.sort.direction === "asc") {
      state.sort = { column: columnKey, direction: "desc" };
    } else {
      state.sort = { column: null, direction: null };
    }

    renderHeaders();
    applyFiltersAndRender(false);
  }

  function clearAllFilters() {
    state.columnFilters = {};
    state.globalQuery = "";
    dom.globalSearch.value = "";
    dom.filterRow.querySelectorAll(".pck-filter-input").forEach((i) => (i.value = ""));
    applyFiltersAndRender();
  }

  // ===========================================================================
  // Označování řádků
  // ===========================================================================

  function toggleRowSelection(rowIndex, selected) {
    if (selected) state.selected.add(rowIndex);
    else state.selected.delete(rowIndex);

    const tr = dom.body.querySelector('tr[data-row-index="' + rowIndex + '"]');
    if (tr) tr.classList.toggle("is-selected", selected);

    syncSelectAllCheckbox();
    renderToolbar();
  }

  function toggleSelectAll(selected) {
    state.filteredData.forEach((row) => {
      if (selected) state.selected.add(row.__index);
      else state.selected.delete(row.__index);
    });

    renderTableBody();
    renderToolbar();
    syncSelectAllCheckbox();
  }

  function clearSelection() {
    state.selected.clear();
    renderTableBody();
    renderToolbar();
    syncSelectAllCheckbox();
  }

  // ===========================================================================
  // Stránkování
  // ===========================================================================

  function goToPage(page) {
    const target = Math.min(Math.max(1, page), getTotalPages());
    if (target === state.currentPage) return;
    state.currentPage = target;
    render();
    dom.container.scrollTop = 0;
  }

  // ===========================================================================
  // Výběr sloupců
  // ===========================================================================

  function renderColumnPicker() {
    const frag = document.createDocumentFragment();

    dataHeaders().forEach((columnKey) => {
      const label = document.createElement("label");
      label.className = "pck-col-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !state.hiddenColumns.has(columnKey);
      checkbox.dataset.column = columnKey;

      label.append(checkbox, document.createTextNode(columnKey));
      frag.appendChild(label);
    });

    dom.columnList.replaceChildren(frag);
    syncColumnsToggleAll();
  }

  /** Hlavní checkbox: zaškrtnutý / částečný / prázdný. */
  function syncColumnsToggleAll() {
    const total = dataHeaders().length;
    const shown = dataHeaders().filter((h) => !state.hiddenColumns.has(h)).length;

    dom.columnsAll.checked = total > 0 && shown === total;
    dom.columnsAll.indeterminate = shown > 0 && shown < total;
  }

  /** Zobrazí nebo skryje všechny sloupce naráz. */
  function toggleAllColumns(visible) {
    if (visible) {
      state.hiddenColumns.clear();
    } else {
      dataHeaders().forEach((key) => state.hiddenColumns.add(key));
      state.columnFilters = {};
      state.sort = { column: null, direction: null };
    }

    saveSettings();
    renderColumnPicker();
    renderHeaders();
    applyFiltersAndRender(false);
  }

  function setColumnVisible(columnKey, visible) {
    if (visible) state.hiddenColumns.delete(columnKey);
    else state.hiddenColumns.add(columnKey);

    if (!visible) {
      delete state.columnFilters[columnKey];
      if (state.sort.column === columnKey) state.sort = { column: null, direction: null };
    }

    saveSettings();
    syncColumnsToggleAll();
    renderHeaders();
    applyFiltersAndRender(false);
  }

  // ===========================================================================
  // Detail řádku
  // ===========================================================================

  /** Pořadí kategorií v panelu (nezávislé na pořadí vyhodnocování pravidel). */
  const DETAIL_ORDER = [
    "General",
    "Primary packaging",
    "Inner packaging",
    "Loading unit",
    "Ostatní",
  ];

  /** Do které kategorie sloupec patří. */
  function groupOf(key) {
    for (const group of DETAIL_GROUPS) {
      if (group.fields && group.fields.includes(key)) return group.title;
      if (group.match && group.match(key)) return group.title;
    }
    return "Ostatní";
  }

  /** ID sekce v detailu — z názvu kategorie (má diakritiku i mezery). */
  function groupSlug(title) {
    return (
      "detail-" +
      title
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    );
  }

  /** Lišta pro přeskakování mezi kategoriemi — stejná logika jako v panelu. */
  function buildDetailNav(titles, buckets, totals) {
    const nav = document.createElement("nav");
    nav.className = "pck-detail-nav";
    nav.setAttribute("aria-label", "Kategorie");

    titles.forEach((title, i) => {
      const filled = buckets.get(title).length;
      const total = totals.get(title);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pck-detail-nav-item" + (i === 0 ? " active" : "");
      btn.dataset.target = groupSlug(title);
      btn.innerHTML =
        '<span class="pck-detail-nav-label">' + escapeHtml(title) + "</span>" +
        '<span class="pck-detail-nav-count' +
        (filled === total ? " is-complete" : "") +
        '">' + filled + "/" + total + "</span>";
      nav.appendChild(btn);
    });

    nav.addEventListener("click", (e) => {
      const btn = e.target.closest(".pck-detail-nav-item");
      if (!btn) return;

      const section = document.getElementById(btn.dataset.target);
      if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });

      nav.querySelectorAll(".pck-detail-nav-item").forEach((item) => {
        item.classList.toggle("active", item === btn);
      });
    });

    return nav;
  }

  /** Zvýrazní kategorii, u které uživatel právě je. */
  function watchDetailSections(nav, sections, root) {
    if (detailObserver) detailObserver.disconnect();

    detailObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
          )[0];

        if (!visible) return;

        nav.querySelectorAll(".pck-detail-nav-item").forEach((item) => {
          item.classList.toggle("active", item.dataset.target === visible.target.id);
        });
      },
      { root, rootMargin: "-10% 0px -70% 0px" }
    );

    sections.forEach((section) => detailObserver.observe(section));
  }

  let detailObserver = null;

  function openRowDetail(rowIndex) {
    const row = state.allTableData[rowIndex];
    if (!row) return;

    state.detailIndex = rowIndex;

    dom.drawerTitle.textContent =
      [row["Part Number"], row["Part Name"]].filter(Boolean).join(" · ") ||
      "Záznam " + (row.ID ?? "");

    // Rozdělení polí do kategorií. Vykreslují se jen vyplněná (buckets),
    // ale počítadlo musí ukázat i ta prázdná (totals) — jinak by "8" nic neříkalo.
    const buckets = new Map(DETAIL_ORDER.map((title) => [title, []]));
    const totals = new Map(DETAIL_ORDER.map((title) => [title, 0]));

    dataHeaders().forEach((key) => {
      const title = groupOf(key);
      totals.set(title, totals.get(title) + 1);

      const value = row[key];
      if (value == null || value === "") return; // prázdná pole detail nezahltí
      buckets.get(title).push(key);
    });

    const frag = document.createDocumentFragment();
    const usedTitles = [];
    const sections = [];

    DETAIL_ORDER.forEach((title) => {
      const keys = buckets.get(title);
      if (!keys.length) return;

      usedTitles.push(title);

      const section = document.createElement("section");
      section.className = "pck-group";
      section.id = groupSlug(title);

      const heading = document.createElement("h3");
      heading.className = "pck-group-title";
      heading.innerHTML =
        escapeHtml(title) +
        '<span class="pck-group-count">' + keys.length + "</span>";
      section.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "pck-group-grid";

      keys.forEach((key) => {
        const field = document.createElement("div");
        field.className =
          "pck-field" + (DETAIL_WIDE_FIELDS.has(key) ? " pck-field-wide" : "");

        const label = document.createElement("span");
        label.className = "pck-field-label";
        label.textContent = key;

        const valueRow = document.createElement("div");
        valueRow.className = "pck-field-row";

        const value = document.createElement("span");
        value.className = "pck-field-value";
        value.innerHTML = formatCellValue(row[key], key);

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "pck-copy-field";
        copyBtn.dataset.value = String(row[key]);
        copyBtn.title = "Zkopírovat hodnotu";
        copyBtn.setAttribute("aria-label", "Zkopírovat: " + key);
        copyBtn.innerHTML = ICON_COPY;

        valueRow.append(value, copyBtn);
        field.append(label, valueRow);
        grid.appendChild(field);
      });

      section.appendChild(grid);
      sections.push(section);
      frag.appendChild(section);
    });

    // Levý sloupec s kategoriemi + pravý sloupec s obsahem, který scrolluje.
    const nav = buildDetailNav(usedTitles, buckets, totals);

    const content = document.createElement("div");
    content.className = "pck-detail-content";
    content.appendChild(frag);

    dom.drawerBody.replaceChildren(nav, content);
    dom.drawer.hidden = false;
    document.body.classList.add("pck-drawer-open");

    watchDetailSections(nav, sections, content);

    dom.drawerClose.focus();
  }

  function closeRowDetail() {
    if (detailObserver) {
      detailObserver.disconnect();
      detailObserver = null;
    }

    dom.drawer.hidden = true;
    state.detailIndex = null;
    document.body.classList.remove("pck-drawer-open");
  }

  /** Celý záznam jako "Sloupec<TAB>Hodnota" po kategoriích – vloží se i do Excelu. */
  function copyWholeRecord(button) {
    const row = state.allTableData[state.detailIndex];
    if (!row) return;

    const buckets = new Map(DETAIL_ORDER.map((title) => [title, []]));

    dataHeaders().forEach((key) => {
      if (row[key] == null || row[key] === "") return;
      buckets.get(groupOf(key)).push(key + "\t" + row[key]);
    });

    const lines = [];
    DETAIL_ORDER.forEach((title) => {
      const rows = buckets.get(title);
      if (!rows.length) return;
      if (lines.length) lines.push("");
      lines.push("[" + title + "]", ...rows);
    });

    copyToClipboard(lines.join("\n"), button);
  }

  // ===========================================================================
  // Export
  // ===========================================================================

  function exportData() {
    const rows = state.selected.size
      ? state.filteredData.filter((r) => state.selected.has(r.__index))
      : state.filteredData;

    if (!rows.length) {
      alert("Není co exportovat – aktuální výběr neobsahuje žádné řádky.");
      return;
    }

    const headers = visibleHeaders().filter((h) => !SYSTEM_COLUMNS.has(h));
    const stamp = new Date().toISOString().slice(0, 10);

    if (window.XLSX) {
      const data = rows.map((row) => {
        const out = {};
        headers.forEach((h) => { out[h] = row[h] == null ? "" : row[h]; });
        return out;
      });

      const sheet = window.XLSX.utils.json_to_sheet(data, { header: headers });
      const book = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(book, sheet, "PCK");
      window.XLSX.writeFile(book, "pck_export_" + stamp + ".xlsx");
      return;
    }

    const toCell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const lines = ["sep=;", headers.map(toCell).join(";")];
    rows.forEach((row) => lines.push(headers.map((h) => toCell(row[h])).join(";")));

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pck_export_" + stamp + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // ===========================================================================
  // Načtení dat
  // ===========================================================================

  /**
   * Akční sloupec se vykreslí jen tam, kde ho stránka vyžádá:
   *   <script>window.pckDtbActions = true;</script>
   * Na read-only stránce (pckDtbSearch.html) se nenastavuje nic.
   */
  function actionsEnabled() {
    return window.pckDtbActions === true;
  }

  /** Sloupec s checkboxy lze vypnout: window.pckDtbSelection = false. */
  function selectionEnabled() {
    return window.pckDtbSelection !== false;
  }

  function buildActionsHtml(id) {
    const safeId = escapeHtml(id);
    const base = "pck-btn-inline";

    return (
      '<button type="button" class="' + base + ' btn-edit" data-id="' + safeId + '">Upravit</button>' +
      '<button type="button" class="' + base + ' btn-duplicate" data-id="' + safeId + '">Duplikovat</button>' +
      '<button type="button" class="' + base + ' btn-delete" data-id="' + safeId + '">Smazat</button>'
    );
  }

  async function loadData() {
    dom.refreshBtn.disabled = true;
    dom.status.textContent = "Načítám…";
    showMessage("Načítám data…");

    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });

      if (!response.ok) {
        showMessage("Server odpověděl chybou " + response.status + ".", true);
        dom.status.textContent = "Načtení selhalo";
        return;
      }

      const data = await response.json();

      if (!Array.isArray(data) || !data.length) {
        showMessage("Databáze nevrátila žádné záznamy.");
        dom.status.textContent = "0 záznamů";
        return;
      }

      const withActions = actionsEnabled();

      state.tableHeaders = Object.keys(data[0]);
      if (withActions) state.tableHeaders.unshift(ACTIONS_COL);
      if (selectionEnabled()) state.tableHeaders.unshift(SELECT_COL);

      state.selected.clear();

      state.allTableData = data.map((row, i) => {
        const enriched = Object.assign({}, row);
        if (withActions) enriched[ACTIONS_COL] = buildActionsHtml(row.ID);
        enriched.__index = i;
        return enriched;
      });

      state.loadedAt = new Date();

      buildSearchIndex();
      renderColumnPicker();
      renderHeaders();
      applyFiltersAndRender(false);
      renderStatus();
    } catch (error) {
      console.error("pckDtbSearch: fetch error", error);
      showMessage("Data se nepodařilo načíst. Zkontrolujte připojení k serveru.", true);
      dom.status.textContent = "Načtení selhalo";
    } finally {
      dom.refreshBtn.disabled = false;
    }
  }

  // ===========================================================================
  // Události
  // ===========================================================================

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    // --- Hlavička: řazení + označit vše ---
    dom.headerRow.addEventListener("click", (e) => {
      const btn = e.target.closest(".pck-sort-btn");
      if (btn) toggleSort(btn.dataset.column);
    });

    dom.headerRow.addEventListener("change", (e) => {
      if (e.target.id === "pck-select-all") toggleSelectAll(e.target.checked);
    });

    // --- Filtry ---
    dom.filterRow.addEventListener("input", (e) => {
      const input = e.target.closest(".pck-filter-input");
      if (!input) return;
      state.columnFilters[input.dataset.column] = input.value;
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => applyFiltersAndRender(), FILTER_DEBOUNCE_MS);
    });

    dom.globalSearch.addEventListener("input", (e) => {
      state.globalQuery = e.target.value;
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => applyFiltersAndRender(), FILTER_DEBOUNCE_MS);
    });

    dom.clearBtn.addEventListener("click", clearAllFilters);
    if (dom.clearSelectionBtn) {
      dom.clearSelectionBtn.addEventListener("click", clearSelection);
    }
    dom.refreshBtn.addEventListener("click", loadData);
    dom.exportBtn.addEventListener("click", exportData);

    // --- Výběr sloupců ---
    dom.columnsBtn.addEventListener("click", () => {
      dom.columnPanel.hidden = !dom.columnPanel.hidden;
      dom.columnsBtn.setAttribute("aria-expanded", String(!dom.columnPanel.hidden));
    });

    dom.columnList.addEventListener("change", (e) => {
      const box = e.target.closest("input[type=checkbox]");
      if (box) setColumnVisible(box.dataset.column, box.checked);
    });

    dom.columnsAll.addEventListener("change", (e) => {
      toggleAllColumns(e.target.checked);
    });

    document.addEventListener("click", (e) => {
      if (dom.columnPanel.hidden) return;
      if (!dom.columnPanel.contains(e.target) && !dom.columnsBtn.contains(e.target)) {
        dom.columnPanel.hidden = true;
        dom.columnsBtn.setAttribute("aria-expanded", "false");
      }
    });

    // --- Tělo tabulky ---
    dom.body.addEventListener("change", (e) => {
      const box = e.target.closest(".pck-select");
      if (box) toggleRowSelection(parseInt(box.dataset.rowIndex, 10), box.checked);
    });

    dom.body.addEventListener("click", (e) => {
      if (e.target.closest("#pck-retry-btn")) { loadData(); return; }
      if (e.target.closest(".pck-select")) return; // checkbox neotevírá detail

      const psds = e.target.closest(".psds-button");
      if (psds) { window.open(psds.dataset.url, "_blank", "noopener"); return; }

      const action = e.target.closest(".btn-edit, .btn-duplicate, .btn-delete");
      if (action) {
        const type = action.classList.contains("btn-edit") ? "edit"
          : action.classList.contains("btn-duplicate") ? "duplicate" : "delete";
        document.dispatchEvent(new CustomEvent("pck:row-action", {
          detail: { action: type, id: action.dataset.id },
        }));
        return;
      }

      if (e.target.closest("a")) return;

      const tr = e.target.closest("tr[data-row-index]");
      if (tr) openRowDetail(parseInt(tr.dataset.rowIndex, 10));
    });

    // --- Detail řádku (vlastní listener – tělo tabulky sem nedosáhne) ---
    dom.drawerBody.addEventListener("click", (e) => {
      const psds = e.target.closest(".psds-button");
      if (psds) { window.open(psds.dataset.url, "_blank", "noopener"); return; }

      const copyBtn = e.target.closest(".pck-copy-field");
      if (copyBtn) copyToClipboard(copyBtn.dataset.value, copyBtn);
    });

    dom.drawerCopy.addEventListener("click", () => copyWholeRecord(dom.drawerCopy));
    dom.drawerClose.addEventListener("click", closeRowDetail);
    dom.drawerBackdrop.addEventListener("click", closeRowDetail);

    // --- Stránkování ---
    dom.prevBtn.addEventListener("click", (e) => {
      e.preventDefault();
      goToPage(state.currentPage - 1);
    });

    dom.nextBtn.addEventListener("click", (e) => {
      e.preventDefault();
      goToPage(state.currentPage + 1);
    });

    dom.itemsPerPageSel.addEventListener("change", (e) => {
      const value = parseInt(e.target.value, 10);
      if (value > 0) {
        state.itemsPerPage = value;
        state.currentPage = 1;
        saveSettings();
        render();
      }
    });

    // --- Zkratky ---
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!dom.drawer.hidden) closeRowDetail();
        else if (!dom.columnPanel.hidden) dom.columnPanel.hidden = true;
        return;
      }

      const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);

      if (e.key === "/" && !inField) {
        e.preventDefault();
        dom.globalSearch.focus();
        return;
      }

      if (inField || e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === "ArrowLeft") goToPage(state.currentPage - 1);
      if (e.key === "ArrowRight") goToPage(state.currentPage + 1);
    });

    initRowScrollSnap();
  }

  function initRowScrollSnap() {
    if (dom.container.dataset.pckWheelBound) return;
    dom.container.dataset.pckWheelBound = "1";

    dom.container.addEventListener("wheel", (e) => {
      const firstRow = dom.body.firstElementChild;
      if (!firstRow) return;
      const rowHeight = firstRow.offsetHeight;
      if (!rowHeight) return;
      e.preventDefault();
      dom.container.scrollTop += (e.deltaY > 0 ? 1 : -1) * rowHeight;
    }, { passive: false });
  }

  // ===========================================================================
  // Init
  // ===========================================================================

  function pckDtbSearchInit() {
    const byId = (id) => document.getElementById(id);

    Object.assign(dom, {
      container: document.querySelector(".pck-table-container"),
      headerRow: byId("pck-header-row"),
      filterRow: byId("pck-filter-row"),
      body: byId("pck-body"),
      globalSearch: byId("pck-global-search"),
      clearBtn: byId("pck-clear-filters"),
      columnsBtn: byId("pck-columns-btn"),
      columnPanel: byId("pck-columns-panel"),
      columnList: byId("pck-columns-list"),
      columnsAll: byId("pck-columns-all"),
      refreshBtn: byId("pck-refresh-btn"),
      exportBtn: byId("pck-export-btn"),
      status: byId("pck-status"),
      selectionBar: byId("pck-selection-bar"),
      selectionCount: byId("pck-selection-count"),
      clearSelectionBtn: byId("pck-clear-selection"),
      prevBtn: byId("pck-prev-page"),
      nextBtn: byId("pck-next-page"),
      pageInfo: byId("pck-page-info"),
      itemsPerPageSel: byId("pck-items-per-page"),
      drawer: byId("pck-drawer"),
      drawerBackdrop: byId("pck-drawer-backdrop"),
      drawerTitle: byId("pck-drawer-title"),
      drawerBody: byId("pck-drawer-body"),
      drawerCopy: byId("pck-drawer-copy"),
      drawerClose: byId("pck-drawer-close"),
    });

    // Prvky výběru nejsou povinné — stránka může výběr vypnout
    // (window.pckDtbSelection = false) a tenhle blok pak vůbec nemít.
    const OPTIONAL = new Set([
      "selectionBar",
      "selectionCount",
      "clearSelectionBtn",
    ]);

    const missing = Object.entries(dom)
      .filter(([key, el]) => !el && !OPTIONAL.has(key))
      .map(([key]) => key);

    if (missing.length) {
      console.error("pckDtbSearchInit: chybí HTML prvky:", missing.join(", "));
      return;
    }

    dom.drawerCopy.innerHTML = ICON_COPY + "<span>Kopírovat záznam</span>";

    loadSettings();
    readStateFromUrl();

    dom.itemsPerPageSel.value = String(state.itemsPerPage);
    dom.globalSearch.value = state.globalQuery;

    bindEvents();
    loadData();

    window.addEventListener("resize", () => requestAnimationFrame(applyStickyOffsets));
  }

  window.pckDtbSearchInit = pckDtbSearchInit;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", pckDtbSearchInit, { once: true });
  } else {
    pckDtbSearchInit();
  }
})();

