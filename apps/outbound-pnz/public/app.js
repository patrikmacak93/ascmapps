/* ===========================================================================
   app.js - logika stranky Outbound PNZ

   Tok:
   1. Uzivatel klikne do pole a NASKENUJE etiketu (ctecka funguje jako
      klavesnice a na konci posle Enter -> spusti vyhledani), nebo materiál
      zada rucne a da Enter / Vyhledat.
   2. Z naskenovaneho retezce se vyparsuje local_material (viz parseMaterial).
   3. Material se vyhleda pres backend (./api/outbound-pnz), IMT prvniho PN
      se automaticky nacte do inline kiosku pod vyhledavanim.
   4. Vyhledany material se ukaze v badge "Vyhledáno" vedle pole a INPUT SE
      VYMAZE, aby uzivatel mohl rovnou skenovat dalsi etiketu (fokus zustava
      v poli).

   API klic tady zamerne NENI - frontend mluvi jen s vlastnim app-backendem
   (routes/index.js), ten teprve prida klic a zavola sql-connector.
   =========================================================================== */

"use strict";

(function () {
  const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "./api";

  const input = document.getElementById("materialInput");
  const button = document.getElementById("searchBtn");
  const statusEl = document.getElementById("status");
  const pnTabs = document.getElementById("pnTabs");

  const searchedBox = document.getElementById("searchedBox");
  const searchedValue = document.getElementById("searchedValue");

  // Kiosk prvky
  const kiosk = document.getElementById("kiosk");
  const kioskFrame = document.getElementById("kioskFrame");
  const kioskTitle = document.getElementById("kioskTitle");

  const rokEl = document.getElementById("year");
  if (rokEl) rokEl.textContent = new Date().getFullYear();

  /** Bezpecne vlozeni textu (proti XSS - hodnoty jdou z DB, ale i tak). */
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setStatus(text, typ) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (typ ? " status-" + typ : "");
  }

  /* ---------------------------------------------------------------
     Parsovani etikety -> local_material

     Pravidlo: hodnota za datovym identifikatorem "1P" az po nasledujici
     oddelovac. V ukazkove etikete jsou oddelovace zapsane jako "@":
        [)>@06@1PA3C03870001@2P09@3S020689462@Q00060@V@@
                  ^^^^^^^^^^^  <- local_material = A3C03870001

     Nektere ctecky posilaji misto "@" skutecne ridici znaky (GS 0x1D,
     RS 0x1E, EOT 0x04) - bereme je jako oddelovace taky, aby to fungovalo
     bez ohledu na nastaveni ctecky.

     Kdyz retezec zadny "1P" blok neobsahuje (uzivatel zadal material rucne),
     vratime ho tak, jak je (jen orezany).
  --------------------------------------------------------------- */
  function parseMaterial(raw) {
    if (!raw) return "";
    // orez bile znaky vc. pripadneho CR/LF z konce skenu
    const s = raw.replace(/[\r\n]+/g, "").trim();

    // oddelovac = '@' nebo ridici znaky GS/RS/EOT
    // najdi: <oddelovac>1P<hodnota bez oddelovace>
    const re = /[@\x1d\x1e\x04]1P([^@\x1d\x1e\x04]*)/;
    const m = s.match(re);
    if (m) return m[1].trim();

    // fallback: neni to etiketa -> ber cely vstup jako material
    return s;
  }

  /* ---------------------------------------------------------------
     Kiosk - nacteni konkretniho PN
  --------------------------------------------------------------- */

  function nacistDoKiosku(pn, url) {
    if (!url) {
      skrytKiosk();
      return;
    }
    kioskTitle.textContent = "IMT · " + pn;
    kioskFrame.src = url;
    kiosk.hidden = false;
  }

  function skrytKiosk() {
    kiosk.hidden = true;
    kioskFrame.src = "about:blank"; // zastavi nacitani IMT
  }

  /* ---------------------------------------------------------------
     Prepinaci zalozky PN (jen kdyz je vic nez jedno PN)
  --------------------------------------------------------------- */

  function vykreslitTaby(radky) {
    const pouzitelne = radky.filter((r) => r.imt_url);

    if (pouzitelne.length <= 1) {
      pnTabs.hidden = true;
      pnTabs.innerHTML = "";
      return;
    }

    pnTabs.hidden = false;
    pnTabs.innerHTML = pouzitelne
      .map(
        (r, i) =>
          `<button type="button" class="pn-tab${i === 0 ? " pn-tab-active" : ""}" ` +
          `data-idx="${i}">${escapeHtml(r.assigned_pn || "—")}</button>`
      )
      .join("");

    const taby = pnTabs.querySelectorAll(".pn-tab");
    taby.forEach((tab) => {
      const idx = Number(tab.getAttribute("data-idx"));
      const r = pouzitelne[idx];
      tab.addEventListener("click", () => {
        taby.forEach((t) => t.classList.remove("pn-tab-active"));
        tab.classList.add("pn-tab-active");
        nacistDoKiosku(r.assigned_pn || "—", r.imt_url);
      });
    });
  }

  /* ---------------------------------------------------------------
     Badge "Vyhledáno"
  --------------------------------------------------------------- */

  function ukazatVyhledano(material) {
    searchedValue.textContent = material;
    searchedBox.hidden = false;
  }

  /* ---------------------------------------------------------------
     Zpracovani vysledku
  --------------------------------------------------------------- */

  function zobrazitVysledek(radky, material) {
    const pouzitelne = radky.filter((r) => r.imt_url);

    if (!radky.length) {
      setStatus(`Pro "${material}" nebyl nalezen žádný záznam.`, "empty");
      pnTabs.hidden = true;
      pnTabs.innerHTML = "";
      skrytKiosk();
      return;
    }

    if (!pouzitelne.length) {
      setStatus(`Pro "${material}" existuje záznam, ale bez odkazu do IMT.`, "empty");
      pnTabs.hidden = true;
      pnTabs.innerHTML = "";
      skrytKiosk();
      return;
    }

    if (pouzitelne.length === 1) {
      setStatus(`Nalezeno PN ${pouzitelne[0].assigned_pn} pro "${material}".`, "ok");
    } else {
      setStatus(
        `Nalezeno ${pouzitelne.length} přiřazených PN pro "${material}". Přepínej mezi nimi záložkami.`,
        "ok"
      );
    }

    vykreslitTaby(radky);
    nacistDoKiosku(pouzitelne[0].assigned_pn || "—", pouzitelne[0].imt_url);
  }

  /* ---------------------------------------------------------------
     Vyhledavani
  --------------------------------------------------------------- */

  async function vyhledat() {
    const raw = input.value || "";
    const material = parseMaterial(raw);

    if (!material) {
      setStatus("Naskenuj etiketu nebo zadej materiálové číslo.", "empty");
      input.focus();
      return;
    }

    // Input hned vymazat + vratit fokus, aby slo rovnou skenovat dalsi etiketu.
    input.value = "";
    input.focus();

    ukazatVyhledano(material);
    setStatus("Vyhledávám…", "loading");
    button.disabled = true;

    try {
      const url = `${API_BASE}/outbound-pnz?local_material=${encodeURIComponent(material)}`;
      const odpoved = await fetch(url, { headers: { Accept: "application/json" } });

      if (!odpoved.ok) {
        const telo = await odpoved.json().catch(() => ({}));
        throw new Error(telo.error || `Server odpověděl chybou ${odpoved.status}.`);
      }

      const data = await odpoved.json();
      zobrazitVysledek(Array.isArray(data) ? data : [], material);
    } catch (err) {
      setStatus(`Chyba: ${err.message}`, "error");
      pnTabs.hidden = true;
      pnTabs.innerHTML = "";
      skrytKiosk();
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener("click", vyhledat);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      vyhledat();
    }
  });
})();