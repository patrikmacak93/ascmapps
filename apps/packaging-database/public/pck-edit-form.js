/* ===========================================================================
   pck-edit-form.js — Packaging Database, jeden formulář pro všechny režimy

   Klasický <script>, vystavuje window.initPckDtbEditForm().
   Tabulku vykresluje sdílený pck-table-search.js (window.pckDtbSearchInit).

   Režimy panelu:
     create    – prázdný formulář          → POST   {API}/pck-database
     edit      – data řádku včetně ID      → PUT    {API}/pck-database/:id
     duplicate – data řádku, ID prázdné    → POST   {API}/pck-database

   Pole jsou definovaná v FIELDS a formulář se z nich generuje. Používají se
   kanonické názvy (= ty, které vrací tabulka) pro čtení i zápis. Node-RED měl
   pro zakládání záznamu jiné názvy polí než pro editaci, což řešila vlastnost
   `add`; nová API bere v obou případech stejné názvy, takže `add` zmizelo.
   =========================================================================== */

   (function () {
    "use strict";
  
    // Adresa API je v pck-config.js (musí se načíst před tímhle skriptem).
    // Mapování starých Node-RED endpointů na nové:
    //   POST /submit-formAdd     -> POST   /pck-database
    //   POST /submit-formEdit    -> PUT    /pck-database/:id
    //   POST /submit-formDelete  -> DELETE /pck-database/:id
    //   POST /upload-psds        -> POST   /psds
    const API = (window.PCK_CONFIG && window.PCK_CONFIG.API_BASE) || "./api";
    const URL_RECORDS = API + "/pck-database";
    const URL_UPLOAD = API + "/psds";
  
    // =========================================================================
    // Číselníky
    // =========================================================================
  
    const PROJECTS = [
      "MB One Box", "BMW iBMUCP", "BMW GEN5 CSC-S", "BMW GEN5 CSC-M",
      "BMW GEN5 CSC-L", "BMW PAG CMC", "BMW PHEV CSC-S", "BMW PHEV CSC-M",
      "BMW PHEV CSC-L", "MB CDCC", "Simos 30", "MB MCM3", "ACM 3.1",
      "MB CDCC 1.0", "MB CDCC 1.9", "AGV 2.2", "EPF 4.0 zoox", "MB DCDC EVA2",
      "BMW GEN5 BMU", "HV Box 3.0", "ACM4", "CDCC 2.0",
    ];
  
    const RE_EX = ["Returnable", "Expendable"];
    const RE_EX_NONE = ["Returnable", "Expendable", "-"];
    const OWNERSHIP = ["Schaeffler", "Supplier"];
  
    const PPACK_TYPES = [
      "Self-supporting tray", "Pallet container", "KLT Box",
      "Barrel / Bucket", "Cardboard box",
    ];
  
    const IPACK_TYPES = [
      "Thermoformed tray", "Foam Tray", "Bulk", "Arranged parts", "Tube",
      "Cardboardplastic separator", "Reel", "Roll",
    ];
  
    const KLT_OPTIONS = [
      "RL-KLT 4047", "RL-KLT 6047", "RL-KLT 6013",
      "E1", "E2", "E22", "E3", "_112580",
    ];
    const KLT_LID_OPTIONS = ["D41", "D61", "Deckel01", "WBG-VIKO-M"];
    const PALLET_OPTIONS = [
      "ESD pallet 1200x800", "nonESD pallet 1200x800 grey",
      "CD ESD pallet 1200x800", "CD pallet 1200x1000",
      "CD ESD pallet 1200x1000", "KTP box",
    ];
    const PALLET_LID_OPTIONS = ["PALETTENDECKEL", "Pallet lid 120x100"];
  
    // =========================================================================
    // Schéma formuláře
    //   key   – název sloupce v DB (= název pole pro EDIT endpoint)
    //   add   – název pole pro ADD endpoint (chybí → stejný jako key)
    //   opts  – hodnoty selectu (chybí → textový input)
    //   free  – dynamické pole: input, nebo select podle nadřazené volby
    // =========================================================================
  
    const GROUPS = [
      { id: "general", label: "Obecné" },
      { id: "ppack", label: "P-pack" },
      { id: "ipack", label: "I-pack" },
      { id: "pallet", label: "Paleta" },
      { id: "doc", label: "PSDS" },
    ];
  
    const FIELDS = [
      // --- Obecné ---
      { g: "general", key: "Project", label: "Project", opts: PROJECTS,
        hint: "Chybí projekt? Přidej ho v sekci Settings." },
      { g: "general", key: "Part Number", label: "Part number" },
      { g: "general", key: "Part Name", label: "Part name" },
      { g: "general", key: "Part Weight", label: "Part weight (kg)" },
      { g: "general", key: "Usage", label: "Usage",
        hint: "Kolik vstupních materiálů padne na jeden hotový výrobek. SAP CS15." },
      { g: "general", key: "Supplier / Customer", label: "Supplier / Customer",
        hint: "Dodavatel u vstupního materiálu, zákazník u FERT." },
      { g: "general", key: "Concept Status",
        label: "Concept status", opts: ["SCR", "PPAP"] },
      { g: "general", key: "Part type", label: "Part type",
        opts: ["RAW", "FERT", "HAWA", "WIP"] },
  
      // --- P-pack ---
      { g: "ppack", key: "Type of P-pack",
        label: "Type of P-pack", opts: PPACK_TYPES },
      { g: "ppack", key: "P-pack (RE/EX)",
        label: "P-pack RE / EX", opts: RE_EX },
      { g: "ppack", key: "P-pack name",
        label: "P-pack description", free: KLT_OPTIONS },
      { g: "ppack", key: "SAP ID (P-pack)", label: "SAP ID P-pack" },
      { g: "ppack", key: "Ownership (P-pack)",
        label: "Ownership P-pack", opts: OWNERSHIP },
      { g: "ppack", key: "Weight of empty (P-pack)",
        label: "Weight of empty P-pack (kg)" },
      { g: "ppack", key: "Weight of full (P-pack)",
        label: "Weight of full P-pack (kg)",
        hint: "Včetně všech komponent a vnitřních obalů." },
      { g: "ppack", key: "Lenght of (P-pack)",
        label: "Lenght of P-pack (mm)" },
      { g: "ppack", key: "Width of (P-pack)",
        label: "Width of P-pack (mm)" },
      { g: "ppack", key: "Height of (P-pack)",
        label: "Height of P-pack (mm)" },
      { g: "ppack", key: "Pcs /P-pack", label: "Pcs / P-pack" },
      { g: "ppack", key: "QTY of P-packs in layer on pallet",
        label: "QTY of P-packs in layer on pallet" },
      { g: "ppack", key: "QTY of layers /pallet",
        label: "QTY of layers on pallet" },
      { g: "ppack", key: "P-pack lid (RE/EX)",
        label: "P-pack lid RE / EX", opts: RE_EX_NONE },
      { g: "ppack", key: "P-pack lid name", label: "P-pack lid name",
        free: KLT_LID_OPTIONS },
      { g: "ppack", key: "P-pack lid weight",
        label: "P-pack lid weight (kg)" },
      { g: "ppack", key: "QTY of P-pack lids /pallet",
        label: "QTY of P-pack lids on pallet" },
      { g: "ppack", key: "P-pack lid SAP ID",
        label: "P-pack lid SAP no" },
  
      // --- I-pack ---
      { g: "ipack", key: "Type of I-pack",
        label: "Type of inner packaging", opts: IPACK_TYPES },
      { g: "ipack", key: "I-pack (RE/EX)",
        label: "Inner packaging RE / EX", opts: RE_EX },
      { g: "ipack", key: "I-pack name",
        label: "Inner packaging name",
        hint: "Např. inner + outer plastic bags." },
      { g: "ipack", key: "I-pack SAP ID",
        label: "Inner packaging SAP no",
        hint: "Když SAP ID není, napiš pomlčku." },
      { g: "ipack", key: "Ownership of I-pack",
        label: "Inner packaging ownership", opts: OWNERSHIP },
      { g: "ipack", key: "Empty I-pack weight",
        label: "Empty inner packaging weight (kg)" },
      { g: "ipack", key: "Full I-pack weight",
        label: "Full inner packaging weight (kg)" },
      { g: "ipack", key: "I-pack lenght",
        label: "Inner packaging lenght (mm)" },
      { g: "ipack", key: "I-pack width",
        label: "Inner packaging width (mm)" },
      { g: "ipack", key: "I-pack height",
        label: "Inner packaging height (mm)" },
      { g: "ipack", key: "Pcs /I-pack",
        label: "Pcs / inner packaging" },
      { g: "ipack", key: "QTY of I-pack in P-pack",
        label: "QTY of inner packaging inside P-pack" },
      { g: "ipack", key: "QTY of layers of I-pack in P-pack",
        label: "QTY of layers inside P-pack",
        hint: "Rozliší, jestli jsou vrstvy v jednom sloupci, nebo je sloupců víc." },
      { g: "ipack", key: "Description of add I-packs inside P-pack",
        label: "Other packaging materials inside P-pack", wide: true,
        hint: "Např. desiccant bag, filling materials." },
  
      // --- Paleta ---
      { g: "pallet", key: "Pallet (RE/EX))",
        label: "Pallet RE / EX", opts: RE_EX },
      { g: "pallet", key: "Pallet name", label: "Pallet name", free: PALLET_OPTIONS },
      { g: "pallet", key: "Pallet SAP ID", label: "Pallet SAP no" },
      { g: "pallet", key: "Empty pallet weight",
        label: "Empty pallet weight (kg)" },
      { g: "pallet", key: "Pallet lenght",
        label: "Pallet lenght (mm)" },
      { g: "pallet", key: "Pallet width",
        label: "Pallet width (mm)" },
      { g: "pallet", key: "Empty pallet height",
        label: "Height of empty pallet (mm)" },
      { g: "pallet", key: "Full pallet height",
        label: "Height of full pallet (mm)",
        hint: "Celková výška palety připravené k odeslání." },
      { g: "pallet", key: "Pallet lid (RE/EX)",
        label: "Pallet lid RE / EX", opts: RE_EX_NONE },
      { g: "pallet", key: "Pallet lid name",
        label: "Pallet lid name", free: PALLET_LID_OPTIONS },
      { g: "pallet", key: "Pallet lid SAP ID",
        label: "Pallet lid SAP no" },
      { g: "pallet", key: "Pallet lid weight",
        label: "Pallet lid weight (kg)" },
    ];
  
    /**
     * Řídicí pole: podle své hodnoty přepnou volné pole na dropdown
     * a zamknou pole, která se dopočítávají v DB.
     */
    const RULES = [
      {
        when: "Type of P-pack",
        is: "KLT Box",
        free: "P-pack name",
        placeholder: "Vyber typ KLT",
        locks: [
          "SAP ID (P-pack)", "Weight of empty (P-pack)", "Lenght of (P-pack)",
          "Width of (P-pack)", "Height of (P-pack)",
        ],
      },
      {
        when: "P-pack lid (RE/EX)",
        is: "Returnable",
        free: "P-pack lid name",
        placeholder: "Vyber typ víka",
        locks: ["P-pack lid weight", "P-pack lid SAP ID"],
      },
      {
        when: "Pallet (RE/EX))",
        is: "Returnable",
        free: "Pallet name",
        placeholder: "Vyber typ palety",
        locks: [
          "Pallet SAP ID", "Empty pallet weight", "Pallet lenght",
          "Pallet width", "Empty pallet height",
        ],
      },
      {
        when: "Pallet lid (RE/EX)",
        is: "Returnable",
        free: "Pallet lid name",
        placeholder: "Vyber typ víka palety",
        locks: ["Pallet lid weight", "Pallet lid SAP ID"],
      },
    ];
  
    // =========================================================================
    // Pomocné funkce
    // =========================================================================
  
    const byId = (id) => document.getElementById(id);
  
    /** ID prvku pro dané pole. Klíče obsahují mezery a závorky → slug. */
    function fieldId(key) {
      return "f-" + key.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
    }
  
    function normalize(value) {
      return (value ?? "")
        .toString()
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  
    function buildOptions(selectEl, values, placeholder) {
      const first = document.createElement("option");
      first.value = "";
      first.disabled = true;
      first.selected = true;
      first.textContent = placeholder;
      selectEl.appendChild(first);
  
      values.forEach((value) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        selectEl.appendChild(opt);
      });
    }
  
    // =========================================================================
    // Sestavení formuláře
    // =========================================================================
  
    function buildForm(form, nav) {
      GROUPS.forEach((group) => {
        const fieldset =
          group.id === "doc" ? buildUpload() : buildGroup(group);
  
        form.appendChild(fieldset);
  
        // Odkaz v levé liště: název skupiny + počítadlo vyplněných polí
        const link = document.createElement("button");
        link.type = "button";
        link.className = "record-nav-item";
        link.dataset.group = group.id;
        link.innerHTML =
          '<span class="nav-label">' + group.label + "</span>" +
          '<span class="nav-count" data-count="' + group.id + '"></span>';
        nav.appendChild(link);
      });
    }
  
    function buildGroup(group) {
      const fieldset = document.createElement("fieldset");
      fieldset.id = "group-" + group.id;
      fieldset.dataset.group = group.id;
  
      const legend = document.createElement("legend");
      legend.textContent = group.label;
      fieldset.appendChild(legend);
  
      FIELDS.filter((f) => f.g === group.id).forEach((f) => {
        fieldset.appendChild(buildField(f));
      });
  
      return fieldset;
    }
  
    function buildField(f) {
      const wrap = document.createElement("div");
      wrap.className = "field" + (f.wide ? " field-wide" : "");
      wrap.dataset.key = f.key;
  
      const id = fieldId(f.key);
  
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = f.label;
      if (f.hint) label.title = f.hint;
      wrap.appendChild(label);
  
      // Volné pole vzniká/mizí podle RULES — obal si drží slot v gridu.
      const slot = document.createElement("div");
      slot.className = "field-slot";
      slot.dataset.slot = f.key;
  
      if (f.opts) {
        const select = document.createElement("select");
        select.id = id;
        select.name = f.key;
        buildOptions(select, f.opts, "Vyber…");
        slot.appendChild(select);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.id = id;
        input.name = f.key;
        if (f.hint) input.title = f.hint;
        slot.appendChild(input);
      }
  
      wrap.appendChild(slot);
  
      if (f.hint) {
        const hint = document.createElement("p");
        hint.className = "field-hint";
        hint.textContent = f.hint;
        wrap.appendChild(hint);
      }
  
      return wrap;
    }
  
    function buildUpload() {
      const fieldset = document.createElement("fieldset");
      fieldset.id = "group-doc";
      fieldset.dataset.group = "doc";
  
      fieldset.innerHTML =
        "<legend>PSDS</legend>" +
  
        // Stávající dokument — zobrazí se jen u záznamů, které ho mají.
        '<div id="currentDoc" class="current-doc field-wide" hidden>' +
        '  <span class="current-doc-label">Aktuální dokument</span>' +
        '  <a id="currentDocLink" href="#" target="_blank" rel="noopener noreferrer"></a>' +
        '  <button type="button" id="removeDoc" class="pck-btn-inline">Odebrat</button>' +
        "</div>" +
  
        '<div class="field field-wide">' +
        '  <label for="f-psds" id="uploadLabel">Nahrát soubor</label>' +
        '  <input type="file" id="f-psds"' +
        '         accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg">' +
        '  <p id="uploadStatus" class="upload-status" role="status"></p>' +
        '  <input type="hidden" id="f-URL1" name="URL1">' +
        "</div>";
  
      return fieldset;
    }
  
    // =========================================================================
    // Init
    // =========================================================================
  
    function initPckDtbEditForm() {
      const panel = byId("recordPanel");
      const backdrop = byId("recordBackdrop");
      const form = byId("recordForm");
      const nav = byId("recordNav");
      const title = byId("recordTitle");
      const modeTag = byId("recordMode");
      const message = byId("recordMessage");
      const saveBtn = byId("recordSave");
      const idField = byId("f-ID");
      const table = byId("pck-table");
  
      if (!panel || !form) {
        console.error("pck-edit-form: panel nebo formulář chybí.");
        return;
      }
  
      buildForm(form, nav);
  
      const uploadInput = byId("f-psds");
      const uploadStatus = byId("uploadStatus");
      const urlField = byId("f-URL1");
  
      let mode = "create";
      let dirty = false;
  
      // -----------------------------------------------------------------------
      // Zprávy a stav
      // -----------------------------------------------------------------------
  
      function say(text, type) {
        message.textContent = text || "";
        message.dataset.type = type || "info";
      }
  
      function field(key) {
        return form.querySelector('[name="' + CSS.escape(key) + '"]');
      }
  
      function refreshTable() {
        if (typeof window.pckDtbSearchInit === "function") {
          window.pckDtbSearchInit();
        }
      }
  
      /** Počítadlo vyplněných polí u každé skupiny — u padesáti polí se hodí. */
      function updateCounts() {
        GROUPS.forEach((group) => {
          const badge = nav.querySelector('[data-count="' + group.id + '"]');
          if (!badge) return;
  
          // PSDS není pole ze schématu — buď dokument je, nebo není.
          if (group.id === "doc") {
            const has = !!(urlField && urlField.value);
            badge.textContent = has ? "1/1" : "0/1";
            badge.classList.toggle("nav-count-done", has);
            return;
          }
  
          const keys = FIELDS.filter((f) => f.g === group.id).map((f) => f.key);
  
          const active = keys.filter((k) => {
            const el = field(k);
            return el && !el.disabled;
          });
  
          const filled = active.filter(
            (k) => normalize(field(k).value) !== ""
          ).length;
  
          badge.textContent = filled + "/" + active.length;
          badge.classList.toggle(
            "nav-count-done",
            filled === active.length && active.length > 0
          );
        });
      }
  
      // -----------------------------------------------------------------------
      // Dynamická pole (RULES)
      // -----------------------------------------------------------------------
  
      /** Přepne volné pole na select / input a zamkne dopočítávaná pole. */
      function applyRule(rule, keepValue) {
        const controller = field(rule.when);
        if (!controller) return;
  
        const active = controller.value === rule.is;
        const slot = form.querySelector('[data-slot="' + CSS.escape(rule.free) + '"]');
        if (!slot) return;
  
        const spec = FIELDS.find((f) => f.key === rule.free);
        const previous = keepValue ? normalize(slot.firstElementChild?.value) : "";
        const id = fieldId(rule.free);
  
        let el;
        if (active) {
          el = document.createElement("select");
          el.id = id;
          el.name = rule.free;
          buildOptions(el, spec.free, rule.placeholder);
  
          // Hodnota z DB nemusí být v číselníku (starší záznamy) — doplníme ji.
          if (previous && !spec.free.includes(previous)) {
            const extra = document.createElement("option");
            extra.value = previous;
            extra.textContent = previous + " (mimo číselník)";
            el.appendChild(extra);
          }
          if (previous) el.value = previous;
        } else {
          el = document.createElement("input");
          el.type = "text";
          el.id = id;
          el.name = rule.free;
          el.value = previous;
        }
  
        slot.replaceChildren(el);
  
        rule.locks.forEach((key) => {
          const locked = field(key);
          if (!locked) return;
  
          locked.disabled = active;
          locked.closest(".field")?.classList.toggle("field-locked", active);
          if (active) locked.value = "";
        });
      }
  
      function applyAllRules(keepValues) {
        RULES.forEach((rule) => applyRule(rule, keepValues));
        updateCounts();
      }
  
      RULES.forEach((rule) => {
        const controller = field(rule.when);
        if (controller) {
          controller.addEventListener("change", () => applyRule(rule, false));
        }
      });
  
      // -----------------------------------------------------------------------
      // Otevírání panelu
      // -----------------------------------------------------------------------
  
      const MODE_LABEL = {
        create: "Nový záznam",
        edit: "Upravit",
        duplicate: "Duplikát",
      };
  
      function openPanel(nextMode, values) {
        mode = nextMode;
  
        form.reset();
        idField.value = "";
        if (uploadStatus) uploadStatus.textContent = "";
        if (urlField) urlField.value = "";
        say("");
  
        if (values) {
          Object.entries(values).forEach(([key, value]) => {
            if (key === "ID") return;
            setValue(key, value);
          });
        }
  
        applyAllRules(true);
  
        // Volná pole se právě přegenerovala — hodnoty do nich doplníme až teď.
        if (values) {
          RULES.forEach((rule) => setValue(rule.free, values[rule.free]));
        }
  
        // Stávající PSDS. Sloupec se v DB jmenuje PSDS, pole ve formuláři URL1.
        const existingDoc = values ? values.PSDS || values.URL1 || "" : "";
        urlField.value = existingDoc;
        renderCurrentDoc();
  
        if (mode === "edit" && values && values.ID) {
          idField.value = values.ID;
          title.textContent = "Záznam " + values.ID;
        } else if (mode === "duplicate" && values && values.ID) {
          title.textContent = "Kopie záznamu " + values.ID;
          say("Uložením vznikne nový záznam. Původní zůstane beze změny.", "info");
        } else {
          title.textContent = "Nový záznam";
        }
  
        modeTag.textContent = MODE_LABEL[mode];
        modeTag.dataset.mode = mode;
        saveBtn.textContent = mode === "edit" ? "Uložit změny" : "Vytvořit záznam";
  
        updateCounts();
        setActiveGroup(GROUPS[0].id);
  
        dirty = false;
        panel.hidden = false;
        backdrop.hidden = false;
        document.body.classList.add("panel-open");
  
        const first = form.querySelector("select, input:not([type=hidden])");
        if (first) first.focus();
      }
  
      function setValue(key, raw) {
        const el = field(key);
        if (!el || raw == null) return;
  
        const value = normalize(raw);
  
        if (el.tagName !== "SELECT") {
          el.value = value;
          return;
        }
  
        const match = Array.from(el.options).find(
          (o) => normalize(o.value).toLowerCase() === value.toLowerCase()
        );
  
        if (match) {
          el.value = match.value;
        } else if (value) {
          // Hodnota z DB mimo číselník — radši ji ukázat než zahodit.
          const extra = document.createElement("option");
          extra.value = value;
          extra.textContent = value + " (mimo číselník)";
          el.appendChild(extra);
          el.value = value;
        }
      }
  
      function closePanel(force) {
        if (dirty && !force) {
          if (!confirm("Máš neuložené změny. Zavřít panel a zahodit je?")) return;
        }
  
        panel.hidden = true;
        backdrop.hidden = true;
        document.body.classList.remove("panel-open");
        dirty = false;
      }
  
      form.addEventListener("input", () => {
        dirty = true;
        updateCounts();
      });
  
      form.addEventListener("change", () => {
        dirty = true;
        updateCounts();
      });
  
      byId("pck-new-record").addEventListener("click", () => openPanel("create", null));
      byId("recordClose").addEventListener("click", () => closePanel(false));
      byId("recordCancel").addEventListener("click", () => closePanel(false));
      backdrop.addEventListener("click", () => closePanel(false));
  
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !panel.hidden) closePanel(false);
      });
  
      window.addEventListener("beforeunload", (e) => {
        if (!panel.hidden && dirty) e.preventDefault();
      });
  
      // -----------------------------------------------------------------------
      // Levá lišta se skupinami
      // -----------------------------------------------------------------------
  
      function setActiveGroup(id) {
        nav.querySelectorAll(".record-nav-item").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.group === id);
        });
      }
  
      nav.addEventListener("click", (e) => {
        const btn = e.target.closest(".record-nav-item");
        if (!btn) return;
  
        const target = byId("group-" + btn.dataset.group);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveGroup(btn.dataset.group);
      });
  
      // Aktivní skupina podle scrollu formuláře
      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          if (visible) setActiveGroup(visible.target.dataset.group);
        },
        { root: form, rootMargin: "-10% 0px -70% 0px" }
      );
  
      form.querySelectorAll("fieldset[data-group]").forEach((fs) => observer.observe(fs));
  
      // -----------------------------------------------------------------------
      // Čtení řádku tabulky
      // -----------------------------------------------------------------------
  
      /** Buňka s PSDS/odkazem obsahuje tlačítko nebo <a> — text v ní je popisek. */
      function cellValue(cell) {
        const link = cell.querySelector("[data-url]") || cell.querySelector("a");
        if (link) return link.dataset.url || link.getAttribute("href") || "";
        return normalize(cell.textContent);
      }
  
      function readRow(rowTr) {
        const values = {};
  
        const tagged = rowTr.querySelectorAll("td[data-field]");
        if (tagged.length) {
          tagged.forEach((cell) => {
            if (cell.dataset.field) {
              values[cell.dataset.field] = cellValue(cell);
            }
          });
          return values;
        }
  
        // Fallback: párování podle hlavičky
        const headerRow = byId("pck-header-row");
        if (!headerRow) return values;
  
        const headers = Array.from(headerRow.children).map((th) => {
          const btn = th.querySelector("[data-column]");
          return btn ? btn.dataset.column : normalize(th.textContent);
        });
  
        Array.from(rowTr.children).forEach((cell, i) => {
          if (headers[i]) values[headers[i]] = cellValue(cell);
        });
  
        return values;
      }
  
      // -----------------------------------------------------------------------
      // Akce v tabulce
      // -----------------------------------------------------------------------
  
      if (table && !table.dataset.pckActionsBound) {
        table.dataset.pckActionsBound = "1";
  
        table.addEventListener("click", (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
  
          const row = btn.closest("tr");
          if (!row) return;
  
          if (btn.classList.contains("btn-edit")) {
            openPanel("edit", readRow(row));
          }
  
          if (btn.classList.contains("btn-duplicate") || btn.classList.contains("btn-copy")) {
            openPanel("duplicate", readRow(row));
          }
  
          if (btn.classList.contains("btn-delete")) {
            deleteRecord(btn, row);
          }
        });
      }
  
      // Sloupec Actions (Upravit / Duplikovat / Smazat) vykresluje
      // pck-table-search.js; kliknutí odchytává delegovaný listener výše.
  
      // -----------------------------------------------------------------------
      // PSDS dokument
      // -----------------------------------------------------------------------
  
      const currentDoc = byId("currentDoc");
      const currentDocLink = byId("currentDocLink");
      const removeDocBtn = byId("removeDoc");
      const uploadLabel = byId("uploadLabel");
  
      /** Ukáže, co je k záznamu přiložené teď, a podle toho pojmenuje upload. */
      function renderCurrentDoc() {
        const url = urlField.value;
  
        if (url) {
          currentDoc.hidden = false;
          currentDocLink.href = url;
          currentDocLink.textContent = decodeURIComponent(
            url.split("/").pop() || url
          );
          uploadLabel.textContent = "Nahradit jiným souborem";
        } else {
          currentDoc.hidden = true;
          currentDocLink.removeAttribute("href");
          currentDocLink.textContent = "";
          uploadLabel.textContent = "Nahrát soubor";
        }
      }
  
      removeDocBtn.addEventListener("click", () => {
        urlField.value = "";
        uploadInput.value = "";
        uploadStatus.textContent = "Dokument bude po uložení odebrán.";
        dirty = true;
        renderCurrentDoc();
      });
  
      uploadInput.addEventListener("change", async () => {
        const file = uploadInput.files && uploadInput.files[0];
        if (!file) return;
  
        const body = new FormData();
        body.append("file", file);
  
        uploadStatus.textContent = "Nahrávám…";
  
        try {
          const response = await fetch(URL_UPLOAD, { method: "POST", body });
  
          if (!response.ok) {
            uploadStatus.textContent =
              "Nahrání selhalo (server vrátil " + response.status + ").";
            return;
          }
  
          const result = await response.json();
  
          // Server vrací url jen tehdy, když má v nastavení pevnou základnu
          // (PSDS_PUBLIC_BASE). Jinak dostaneme jen název souboru a absolutní
          // adresu složíme tady — prohlížeč svou adresu zná spolehlivě,
          // na rozdíl od Node aplikace běžící ve virtuální cestě IIS.
          const docUrl =
            (result && result.url) ||
            (result && result.filename
              ? new URL(
                  URL_UPLOAD + "/" + encodeURIComponent(result.filename),
                  window.location.href
                ).href
              : "");
  
          if (docUrl) {
            urlField.value = docUrl;
            uploadStatus.textContent = "Soubor nahrán. Uloží se se záznamem.";
            dirty = true;
            renderCurrentDoc();
          } else {
            uploadStatus.textContent = "Soubor nahrán, ale server nevrátil adresu.";
          }
        } catch (err) {
          console.error("pck-edit-form: upload error", err);
          uploadStatus.textContent = "Soubor se nepodařilo nahrát. Zkus to znovu.";
        }
      });
  
      // -----------------------------------------------------------------------
      // Uložení
      // -----------------------------------------------------------------------
  
      /**
       * Sestaví tělo požadavku. ADD i EDIT používají nově STEJNÉ názvy polí
       * (kanonické = ty, které vrací tabulka) — sjednocené mapování je na
       * serveru v sql-connector/utils/pckDatabaseSloupce.js. Dřív měl Node-RED
       * pro zakládání jiné názvy než pro editaci, což řešila vlastnost `add`
       * ve FIELDS; ta se už nepoužívá.
       *
       * ID se do těla NEDÁVÁ — jde v URL (PUT /pck-database/:id).
       */
      function sestavitPayload() {
        const payload = {};
  
        FIELDS.forEach((f) => {
          const el = field(f.key);
          if (!el || el.disabled) return;
          payload[f.key] = el.value;
        });
  
        payload.URL1 = urlField.value;
        return payload;
      }
  
      /** Pošle JSON a shodí chybu, když server odpoví nenulovým stavem. */
      async function poslatJson(url, method, payload) {
        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: payload === undefined ? undefined : JSON.stringify(payload),
        });
  
        if (!response.ok) {
          let detail = "HTTP " + response.status;
          try {
            const chyba = await response.json();
            if (chyba && chyba.error) detail = chyba.error;
          } catch (e) {
            /* odpověď nebyla JSON — zůstane holý HTTP stav */
          }
          throw new Error(detail);
        }
  
        return response;
      }
  
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
  
        const editing = mode === "edit";
  
        if (editing && !idField.value) {
          say("Chybí ID záznamu. Otevři ho znovu tlačítkem Upravit.", "error");
          return;
        }
  
        saveBtn.disabled = true;
        say(editing ? "Ukládám změny…" : "Zakládám záznam…", "info");
  
        try {
          await poslatJson(
            editing ? URL_RECORDS + "/" + encodeURIComponent(idField.value) : URL_RECORDS,
            editing ? "PUT" : "POST",
            sestavitPayload()
          );
  
          dirty = false;
          refreshTable();
          closePanel(true);
        } catch (err) {
          console.error("pck-edit-form: save error", err);
          say("Uložení selhalo: " + err.message, "error");
        } finally {
          saveBtn.disabled = false;
        }
      });
  
      // -----------------------------------------------------------------------
      // Smazání
      // -----------------------------------------------------------------------
  
      async function deleteRecord(btn, row) {
        const values = readRow(row);
        const id = btn.dataset.id || values.ID;
  
        if (!id) {
          alert("Řádek nemá ID, mazání zrušeno.");
          return;
        }
  
        if (!confirm("Smazat záznam " + id + "? Akce je nevratná.")) return;
  
        try {
          await poslatJson(URL_RECORDS + "/" + encodeURIComponent(id), "DELETE");
          refreshTable();
        } catch (err) {
          console.error("pck-edit-form: delete error", err);
          alert("Smazání selhalo: " + err.message);
        }
      }
  
      applyAllRules(false);
    }
  
    window.initPckDtbEditForm = initPckDtbEditForm;
  })();
  
  
