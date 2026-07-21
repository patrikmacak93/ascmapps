/* =========================================================
   ZÁLOŽKA "GRAFY" (Pareto graf)

   Vykreslí sloupcový + čárový graf: sloupce ukazují potřebu obalů
   (RequiredPackagingQty) po SAP ID, čára ukazuje, kolik už bylo
   nakoupeno (Nakoupeno). Data bere ze sdíleného stavu appState
   (naplněné v common/dataLoader.js po kliknutí na "Načíst data").
========================================================= */
import { $, normalizeNumber, parseRequirementPeriodSortKey, appState } from "../common/zaklad.js";

// Navázání ovládacích prvků záložky "Grafy", které nezávisí na
// právě načtených datech (to dělá initParetoControls, volané po
// každém načtení dat v common/dataLoader.js).
export function initGrafyTab() {
  $("paretoApplyBtn").addEventListener("click", renderParetoFromCache);
}

export function initParetoControls() {
  const select = $("paretoPeriodSelect");
  const paretoStatus = $("paretoStatus");

  const periods = [...new Set(appState.paretoPeriodRows.map(x => String(x.period_label ?? "").trim()).filter(Boolean))];
  periods.sort((a, b) => parseRequirementPeriodSortKey(a) - parseRequirementPeriodSortKey(b));

  select.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const p of periods) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    frag.appendChild(opt);
  }
  select.appendChild(frag);

  if (periods.length === 0) paretoStatus.textContent = "Nenalezena měsíční data pro Pareto graf.";
  else {
    paretoStatus.textContent = `Vyber období a klikni „Aktualizovat“.`;
    select.value = periods[periods.length - 1];
  }
}

export function buildEmptiesNakoupenoMap() {
  const map = new Map();

  for (const r of appState.emptiesData) {
    const sap = String(r.SAP_ID ?? "").trim() || "(prázdné SAP_ID)";
    const nak = normalizeNumber(r.Nakoupeno);
    map.set(sap, (map.get(sap) || 0) + nak);
  }

  return map;
}

export function renderParetoFromCache() {
  const paretoStatus = $("paretoStatus");
  const period = $("paretoPeriodSelect").value;
  const topN = Number($("paretoTopNSelect").value || 15);

  if (!period) {
    paretoStatus.textContent = "Vyber období.";
    return;
  }

  const filtered = appState.paretoPeriodRows.filter(x => String(x.period_label ?? "").trim() === String(period).trim());

  if (filtered.length === 0) {
    paretoStatus.textContent = `Pro období „${period}“ nejsou data.`;
    if (appState.paretoChart) { appState.paretoChart.destroy(); appState.paretoChart = null; }
    return;
  }

  const emptiesMap = buildEmptiesNakoupenoMap();

  // Group by SAP_ID only
  const agg = new Map();
  for (const r of filtered) {
    const sap = String(r.SAP_ID ?? "").trim() || "(prázdné SAP_ID)";
    let it = agg.get(sap);
    if (!it) {
      it = { reqPckSum: 0, nakoupeno: 0, count: 0 };
      agg.set(sap, it);
    }

    it.reqPckSum += normalizeNumber(r.RequiredPackagingQty);
    it.nakoupeno = emptiesMap.get(sap) || 0;
    it.count += 1;
  }

  const items = [];
  for (const [sap, v] of agg.entries()) {
    items.push({
      sap,
      reqPck: v.reqPckSum,
      nakoupeno: v.nakoupeno,
      count: v.count
    });
  }

  // Top N by RequiredPackagingQty
  items.sort((a, b) => b.reqPck - a.reqPck);
  const top = items.slice(0, topN);

  const labels = top.map(x => x.sap);
  const barValues = top.map(x => x.reqPck);
  const lineValues = top.map(x => x.nakoupeno);

  if (appState.paretoChart) appState.paretoChart.destroy();

  const ctx = $("paretoChart");
  appState.paretoChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
      {
        type: "bar",
        order: 1,
        label: "Needed pck (RequiredPackagingQty)",
        data: barValues,
        backgroundColor: "rgba(22, 101, 52, 0.85)",
        borderColor: "rgba(22, 101, 52, 1)",
        borderWidth: 1
      },
      {
        type: "line",
        order: 2,
        label: "Nakoupeno",
        data: lineValues,
        borderColor: "rgba(30, 64, 175, 1)",
        backgroundColor: "rgba(30, 64, 175, 0.12)",
        pointRadius: 3,
        pointHoverRadius: 4,
        tension: 0.25
      }
    ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
        title: { display: false, text: `Top ${topN} SAP_ID | ${period}` },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const idx = ctx.dataIndex;
              const it = top[idx];
              const v = ctx.dataset.type === "line" ? it.nakoupeno : it.reqPck;
              return `${ctx.dataset.label}: ${Number(v).toLocaleString("cs-CZ")}`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: false, text: "SAP_ID" },
          ticks: { autoSkip: false, maxRotation: 60, minRotation: 0 }
        },
        y: {
          title: { display: false, text: "Hodnoty" },
          ticks: { callback: (v) => Number(v).toLocaleString("cs-CZ") },
          grid: { color: "rgba(0,0,0,0.06)" }
        }
      }
    }
  });

  paretoStatus.textContent = `Zobrazeno Top ${topN} SAP_ID podle RequiredPackagingQty. Linka = Nakoupeno z Empties. Zdrojových řádků: ${filtered.length}.`;
}
