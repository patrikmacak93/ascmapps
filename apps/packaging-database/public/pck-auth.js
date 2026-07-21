/* ===========================================================================
   pck-auth.js — přihlášení pro statické stránky (náhrada SPA login.js)

   Použití v HTML (klasický <script>, ne modul — funguje i vedle IIFE skriptů):

     <script src="./pck-auth.js"></script>
     <script>
       pckAuth.protect({
         access: "pckDtbEdit",          // klíč oprávnění z /login API
         content: "#pckDtbEditRoot",    // co se odhalí až po přihlášení
         onReady: () => initPckDtbEditForm()
       });
     </script>

   Rozdíly proti SPA verzi:
   - žádný hash router (#Login, spaHandleHashChange, postLoginHash)
   - přihlašovací dialog si vykreslí sám, HTML se nemusí upravovat
   - po odhlášení / vypršení redirect na rozcestník
   =========================================================================== */

   (function () {
    "use strict";
  
    // Adresa API je na jednom místě — v pck-config.js, který se musí načíst
    // dřív než tenhle skript. Dřív tady byla natvrdo adresa Node-RED (…:1884).
    const API_BASE = (window.PCK_CONFIG && window.PCK_CONFIG.API_BASE) || "./api";
    const LOGIN_API_URL = API_BASE + "/login";
    const STORAGE_KEY = "pckLoginState";
    const INACTIVITY_LIMIT_MS = 20 * 60 * 1000; // 20 minut
    const HOME_URL = "./index.html"; // rozcestník Databáze obalů
  
    let state = {
      isLoggedIn: false,
      username: null,
      accesses: [],
      lastActivity: null,
    };
  
    let inactivityBound = false;
  
    // -------------------------------------------------------------------------
    // Stav (localStorage)
    // -------------------------------------------------------------------------
  
    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
  
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return;
  
        state.isLoggedIn = !!parsed.isLoggedIn;
        state.username = parsed.username || null;
        state.accesses = Array.isArray(parsed.accesses) ? parsed.accesses : [];
        state.lastActivity =
          typeof parsed.lastActivity === "number" ? parsed.lastActivity : null;
      } catch (err) {
        console.warn("pckAuth: stav se nepodařilo načíst.", err);
      }
    }
  
    function saveState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn("pckAuth: stav se nepodařilo uložit.", err);
      }
    }
  
    function clearState() {
      state = {
        isLoggedIn: false,
        username: null,
        accesses: [],
        lastActivity: null,
      };
      saveState();
    }
  
    /** Vrátí true, pokud přihlášení vypršelo (a rovnou ho zruší). */
    function expired() {
      if (!state.isLoggedIn) return true;
      if (!state.lastActivity) return true;
  
      if (Date.now() - state.lastActivity > INACTIVITY_LIMIT_MS) {
        clearState();
        return true;
      }
      return false;
    }
  
    function touch() {
      if (!state.isLoggedIn) return;
      state.lastActivity = Date.now();
      saveState();
    }
  
    // -------------------------------------------------------------------------
    // Oprávnění
    // -------------------------------------------------------------------------
  
    function hasAccess(key) {
      if (expired()) return false;
      if (!key) return true;
      if (!Array.isArray(state.accesses) || !state.accesses.length) return false;
  
      const clean = String(key).replace(/^#/, "");
      const a = state.accesses;
  
      return (
        a.includes("*") ||
        a.includes("ALL") ||
        a.includes(clean) ||
        a.includes("#" + clean)
      );
    }
  
    // -------------------------------------------------------------------------
    // Sledování nečinnosti
    // -------------------------------------------------------------------------
  
    function startInactivityWatch(accessKey) {
      if (inactivityBound) return;
      inactivityBound = true;
  
      ["click", "keydown", "mousemove", "scroll", "touchstart"].forEach((ev) => {
        document.addEventListener(ev, touch, { passive: true });
      });
  
      setInterval(() => {
        if (state.isLoggedIn && expired()) {
          alert("Byl jsi odhlášen z důvodu nečinnosti.");
          window.location.href = HOME_URL;
        } else if (state.isLoggedIn && !hasAccess(accessKey)) {
          window.location.href = HOME_URL;
        }
      }, 60 * 1000);
    }
  
    // -------------------------------------------------------------------------
    // Přihlašovací dialog (vykreslí se sám, styly ve firemní paletě)
    // -------------------------------------------------------------------------
  
    const DIALOG_CSS = `
      #pck-auth-gate {
        --sch-green: #00893d;
        --sch-green-dark: #006c30;
        --sch-anthracite: #3c3c3b;
        --sch-grey-line: #d7d9d6;
        --sch-red: #c8102e;
  
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(60, 60, 59, 0.55);
        font-family: "Frutiger", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: var(--sch-anthracite);
      }
      #pck-auth-gate[hidden] { display: none; }
  
      #pck-auth-gate .pck-auth-card {
        width: 100%;
        max-width: 360px;
        background: #fff;
        border-top: 3px solid var(--sch-green);
        border-radius: 2px;
        padding: 28px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
      }
      #pck-auth-gate h2 {
        margin: 0 0 4px;
        font-size: 1.25rem;
        font-weight: 600;
      }
      #pck-auth-gate .pck-auth-sub {
        margin: 0 0 20px;
        font-size: 0.85rem;
        color: #6b6f6c;
      }
      #pck-auth-gate label {
        display: block;
        margin-bottom: 14px;
        font-size: 0.8rem;
        font-weight: 600;
      }
      #pck-auth-gate input {
        display: block;
        width: 100%;
        margin-top: 5px;
        padding: 9px 10px;
        font: inherit;
        font-size: 0.9rem;
        font-weight: 400;
        border: 1px solid var(--sch-grey-line);
        border-radius: 2px;
        box-sizing: border-box;
      }
      #pck-auth-gate input:focus-visible {
        outline: 2px solid var(--sch-green);
        outline-offset: 1px;
        border-color: var(--sch-green);
      }
      #pck-auth-gate .pck-auth-actions {
        display: flex;
        gap: 10px;
        margin-top: 20px;
      }
      #pck-auth-gate button {
        flex: 1;
        padding: 9px 14px;
        font: inherit;
        font-size: 0.85rem;
        font-weight: 600;
        border-radius: 2px;
        cursor: pointer;
        border: 1px solid var(--sch-grey-line);
        background: #fff;
        color: var(--sch-anthracite);
      }
      #pck-auth-gate button.primary {
        border-color: var(--sch-green);
        background: var(--sch-green);
        color: #fff;
      }
      #pck-auth-gate button.primary:hover:not(:disabled) {
        background: var(--sch-green-dark);
        border-color: var(--sch-green-dark);
      }
      #pck-auth-gate button:disabled { opacity: 0.5; cursor: not-allowed; }
  
      #pck-auth-gate .pck-auth-msg {
        margin: 14px 0 0;
        min-height: 1.2em;
        font-size: 0.8rem;
      }
      #pck-auth-gate .pck-auth-msg[data-type="error"] { color: var(--sch-red); }
      #pck-auth-gate .pck-auth-msg[data-type="info"] { color: #6b6f6c; }
    `;
  
    function injectStyles() {
      if (document.getElementById("pck-auth-styles")) return;
      const style = document.createElement("style");
      style.id = "pck-auth-styles";
      style.textContent = DIALOG_CSS;
      document.head.appendChild(style);
    }
  
    /** Vykreslí gate a vrátí Promise, která se splní po úspěšném přihlášení. */
    function showGate(title, accessKey) {
      injectStyles();
  
      const gate = document.createElement("div");
      gate.id = "pck-auth-gate";
      gate.innerHTML = `
        <div class="pck-auth-card" role="dialog" aria-modal="true"
             aria-labelledby="pck-auth-title">
          <h2 id="pck-auth-title">${title}</h2>
          <p class="pck-auth-sub">Sekce je dostupná jen přihlášeným uživatelům. Automatické odhlášení po 20 minutách neaktivity. Prozřízení přístupu, kontaktuje patrik.macak@mail.schaeffler.com</p>
  
          <label>Uživatel
            <input id="pck-auth-user" type="text" autocomplete="username">
          </label>
          <label>Heslo
            <input id="pck-auth-pass" type="password" autocomplete="current-password">
          </label>
  
          <p id="pck-auth-msg" class="pck-auth-msg" role="status"></p>
  
          <div class="pck-auth-actions">
            <button type="button" id="pck-auth-cancel">Zpět na rozcestník</button>
            <button type="button" id="pck-auth-ok" class="primary">Přihlásit</button>
          </div>
        </div>
      `;
      document.body.appendChild(gate);
  
      const user = gate.querySelector("#pck-auth-user");
      const pass = gate.querySelector("#pck-auth-pass");
      const msg = gate.querySelector("#pck-auth-msg");
      const okBtn = gate.querySelector("#pck-auth-ok");
      const cancelBtn = gate.querySelector("#pck-auth-cancel");
  
      user.focus();
  
      function say(text, type) {
        msg.textContent = text;
        msg.dataset.type = type || "info";
      }
  
      return new Promise((resolve) => {
        async function submit() {
          const username = user.value.trim();
          const password = pass.value;
  
          if (!username || !password) {
            say("Vyplň uživatele i heslo.", "error");
            return;
          }
  
          okBtn.disabled = true;
          say("Přihlašuji…", "info");
  
          try {
            const response = await fetch(LOGIN_API_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username, password }),
            });
  
            if (!response.ok) {
              say("Server odpověděl chybou " + response.status + ".", "error");
              okBtn.disabled = false;
              return;
            }
  
            const data = await response.json();
  
            if (data.message !== "Login successful") {
              say(data.message || "Nesprávné jméno nebo heslo.", "error");
              pass.value = "";
              pass.focus();
              okBtn.disabled = false;
              return;
            }
  
            state.isLoggedIn = true;
            state.username = username;
            state.accesses = Array.isArray(data.accesses) ? data.accesses : [];
            state.lastActivity = Date.now();
            saveState();
  
            if (!hasAccess(accessKey)) {
              say("Tento účet nemá přístup do této sekce.", "error");
              pass.value = "";
              okBtn.disabled = false;
              return;
            }
  
            gate.remove();
            resolve();
          } catch (err) {
            console.error("pckAuth: login error", err);
            say("Server je nedostupný. Zkus to znovu.", "error");
            okBtn.disabled = false;
          }
        }
  
        okBtn.addEventListener("click", submit);
        cancelBtn.addEventListener("click", () => {
          window.location.href = HOME_URL;
        });
        gate.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        });
      });
    }
  
    // -------------------------------------------------------------------------
    // Veřejné API
    // -------------------------------------------------------------------------
  
    /**
     * Zamkne stránku. Obsah zůstává skrytý, dokud uživatel nemá potřebné
     * oprávnění. Po přihlášení se zavolá onReady().
     *
     * @param {object} opts
     * @param {string} opts.access   klíč oprávnění (např. "pckDtbEdit")
     * @param {string} [opts.content] CSS selektor obsahu, který se má odhalit
     * @param {string} [opts.title]  nadpis dialogu
     * @param {Function} [opts.onReady]
     */
    async function protect(opts) {
      const cfg = opts || {};
      loadState();
  
      const reveal = () => {
        if (cfg.content) {
          const el = document.querySelector(cfg.content);
          if (el) el.hidden = false;
        }
        touch();
        startInactivityWatch(cfg.access);
        renderUserBar();
        if (typeof cfg.onReady === "function") cfg.onReady();
      };
  
      if (hasAccess(cfg.access)) {
        reveal();
        return;
      }
  
      await showGate(cfg.title || "Přihlášení", cfg.access);
      reveal();
    }
  
    /** Doplní jméno + Odhlásit do prvku #pck-user-bar, pokud na stránce je. */
    function renderUserBar() {
      const bar = document.getElementById("pck-user-bar");
      if (!bar) return;
  
      bar.textContent = state.username ? state.username + " · " : "";
  
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "pck-logout-btn";
      btn.textContent = "Odhlásit";
      btn.addEventListener("click", logout);
      bar.appendChild(btn);
    }
  
    function logout() {
      clearState();
      window.location.href = HOME_URL;
    }
  
    window.pckAuth = {
      protect,
      logout,
      hasAccess,
      isLoggedIn: () => !expired(),
      getUser: () => state.username,
    };
  })();
  
  
