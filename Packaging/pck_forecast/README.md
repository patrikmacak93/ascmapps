## 1. Co appka dělá

Appka zobrazuje přehled o obalovém materiálu (packaging) pro jednotlivé
SAP ID, projekty a materiály:

- kolik obalů/materiálu je potřeba (**požadavky / needs**),
- kolik jich reálně "zbývá v poolu" (**PckPoolBalance**),
- kolik se jich nakoupilo (**Empties**),
- a graficky, kde jsou největší potřeby (**Pareto graf**).

Appka data neukládá lokálně - při každém načtení se stahují čerstvá
z databáze. Appka se sama SQL databáze na nic neptá - o to se stará
sdílené firemní API (`../../shared-api`), viz bod 3.

---

## 2. Jak appku spustit / otevřít

- Appka je teď dvě samostatné služby, obě musí běžet:
  1. **`../../shared-api`** - stará se o přístup do SQL databáze.
  2. **`pck_forecast`** (tahle appka) - business logika + frontend,
     data si bere z `shared-api`.
- Aby appka fungovala, musí být v IIS spuštěný soubor `server.js` pod
  uživatelem, který má přístup do SQL databáze (stejně jako dřív) -
  a to samé platí i pro `shared-api`.
- Pokud `shared-api` běží na jiné adrese/portu, uprav
  `server/nastaveni.js` (nebo nastav proměnnou prostředí
  `PCK_SHARED_API_BASE`).

---

## 3. Odkud appka bere data

Dřív appka sama otevírala spojení do SQL Serveru a psala si vlastní
SQL dotazy. Teď je to jinak:

```
prohlížeč (public/)  →  pck_forecast server (server/)  →  shared-api  →  SQL databáze
```

- **`shared-api`** je jedno malé sdílené API pro celou firmu (ne jen
  pro tuhle appku). Appka mu pošle **text SQL dotazu + parametry**,
  ono ho spustí v databázi a vrátí výsledek. Podrobnosti a bezpečnostní
  poznámky jsou v `../../shared-api/README.md`.
- **`server/sql-dotazy.js`** je jediné místo v appce, kde je napsaný
  skutečný SQL text - viz bod 9.2 níže.
- **`pck_forecast` server** (tahle appka) k datům přidává business
  logiku specifickou jen pro tuhle appku - třeba sestavení stromové
  (pivot) tabulky pro Týdenní/Roční přehled, nebo spojení Pareto dat
  z packaging view a z Empties.
- Appka pořád umí nahrát čerstvá data z Excelu do SQL (tlačítko
  "Načíst data" spouští `load_query1_to_sql.py`) - to je jediná věc,
  která nejde přes shared-api (je to jednorázové spuštění skriptu na
  serveru, ne SQL dotaz).

**Pokud budeš appce chtít přidat nový SQL dotaz** (novou sestavu dat),
stačí přidat nový text dotazu do `server/sql-dotazy.js` a zavolat ho
přes `spustitDotaz(...)` (viz `server/shared-api-klient.js`) v nové
nebo existující routě v `server/api-routes.js`.

---

## 4. Popis obrazovky

Appka má nahoře čtyři záložky (taby):

| Záložka | K čemu slouží |
|---|---|
| **Grafy** | Pareto graf – Top SAP ID podle potřeby obalů |
| **Týdenní přehled** | tabulka s daty po týdnech |
| **Roční přehled** | tabulka s daty po měsících |
| **Empties** | editovatelná tabulka nákupů obalů |

Nahoře úplně vpravo je tlačítko **"Načíst data"** – to natáhne čerstvá
data ze všech tabulek a grafu najednou. Vedle tlačítka je stavový text,
který vám řekne, jestli se data načetla v pořádku, nebo jestli nastala
chyba (a jaká).

---

## 5. Záložka "Grafy" (Pareto graf)

- Graf zobrazuje **sloupce** (kolik obalů je potřeba – `RequiredPackagingQty`)
  a **linku** (kolik už bylo nakoupeno – `Nakoupeno` z tabulky Empties).
- Nahoře si vyberete:
  - **Období** – měsíc, za který se má graf zobrazit,
  - **Top N** – kolik nejvyšších SAP ID se má zobrazit (10/15/20).
- Po výběru klikněte na **"Aktualizovat"** – graf se překreslí.
- Čím vyšší sloupec, tím větší potřeba obalů pro dané SAP ID.

---

## 6. Záložky "Týdenní přehled" a "Roční přehled"

Obě fungují stejně, jen jedna počítá po týdnech a druhá po měsících.

### Hierarchie (stromová struktura)
Data jsou uspořádaná do 3 úrovní:

```
Obal (SAP ID)
 └─ Projekt
     └─ Materiál
```

- U každého řádku je tlačítko **"−" / "+"** – klikem sbalíte/rozbalíte
  danou úroveň (skryjete/zobrazíte projekty pod obalem, nebo materiály
  pod projektem).
- Nahoře v toolbaru jsou 3 rychlá tlačítka:
  - **Obal** – sbalí vše až na úroveň Obal (vidíte jen souhrnné řádky),
  - **Projekt** – rozbalí obaly, ale sbalí projekty,
  - **Materiál** – rozbalí úplně vše až na nejnižší úroveň.

### Zobrazení potřeb (checkboxy)
Vedle rychlých tlačítek jsou dva checkboxy:

- **Potřeby - materiál** – zobrazí navíc sloupec s potřebou materiálu
  (`requirement_qty`) pro každé období.
- **Potřeby - obaly** – zobrazí navíc sloupec s potřebou obalů
  (`RequiredPackagingQty`) pro každé období.

Když je zaškrtnete, přibudou vedle každého období další sloupce.

### Filtrování
Ve sloupcích **Kategorie** a **Disponent** je u nadpisu malá šipka (▾).
Kliknutím se otevře okénko, kde můžete:

- vyhledat konkrétní hodnotu,
- zaškrtnout/odškrtnout, co se má zobrazovat,
- **Vybrat vše** / **Zrušit vše**,
- **Použít** (potvrdí filtr) nebo **Vymazat filtr** (zruší filtr úplně).

### Barvy čísel
- **Zelená** = kladná hodnota (v pořádku / přebytek).
- **Červená** = záporná hodnota (nedostatek).
- **Šedá** = nula.

### Najetí myší / kliknutí na buňku
- Když najedete myší na buňku, zvýrazní se celý řádek, celý sloupec
  a konkrétní buňka – pomáhá to se orientovat ve velké tabulce.
- Kliknutím na buňku ji "podržíte" zvýrazněnou (zůstane zvýrazněná,
  i když odjedete myší jinam) – užitečné, když chcete porovnávat víc
  míst v tabulce. Druhým kliknutím na stejnou buňku zvýraznění zrušíte.

---

## 7. Záložka "Empties"

Zde se evidují nákupy/obaly v systému. Tabulka se nenačte automaticky –
je potřeba kliknout na **"Načíst Empties"**.

- **Přidat řádek** – vytvoří nový prázdný řádek, který pak vyplníte.
- **Editace buňky** – klikněte na buňku, objeví se textové pole nebo
  (u sloupce Projekt) rozbalovací seznam. Po potvrzení (Enter, nebo
  klik mimo pole) se hodnota rovnou uloží do databáze.
  - **Escape** = zahodí rozepsanou změnu a vrátí původní hodnotu.
- Sloupec **Projekt** má napovídaný výběr ze seznamu existujících
  projektů (nejde tam napsat cokoliv, jen vybrat z nabídky).
- Ceny (**Cena za ks**) se automaticky formátují v Kč (CZK).

---

## 8. Nejčastější problémy

| Problém | Co zkusit |
|---|---|
| Appka po otevření nic nezobrazuje | Klikněte na **"Načíst data"** – appka data nenačítá sama automaticky |
| Stavový text hlásí "Chyba při načítání dat" | Zkontrolujte, jestli běží `shared-api` (viz bod 2 a 3) - bez ní appka nemá odkud data vzít |
| Appka se chová jinak, než má, po aktualizaci | Zkuste **Ctrl+F5** (tvrdé obnovení) nebo otevřít v anonymním okně – prohlížeč si appku cachuje |
| Tabulka Empties je prázdná | Klikněte na **"Načíst Empties"** v záložce Empties |
| Filtr nejde zrušit | V okénku filtru klikněte na **"Vymazat filtr"** |

---

## 9. Kde appka žije (pro budoucí orientaci)

Appka je rozdělená na dvě hlavní části:

- **`public/`** – vše, co appka zobrazuje v prohlížeči (HTML, styly,
  logika ovládání). Tuto část servíruje IIS/Express.
- **`server/`** – backend, který appce dodává data (přes `shared-api`,
  viz bod 3). Tato část běží jako samostatný proces (Node.js).

### 9.1 `public/` - frontend, rozdělený podle záložek

```
public/
├── index.html                 hlavní HTML kostra stránky (všechny 4 záložky)
├── css/
│   ├── common.css             společný vzhled - rozvržení, tabulky, hover/výběr
│   ├── grafy.css              vzhled jen pro záložku "Grafy" (Pareto)
│   └── empties.css            vzhled jen pro záložku "Empties"
└── js/
    ├── main.js                bootstrap - napojí tlačítko "Načíst data",
    │                          přepínání záložek, a spustí inicializaci
    │                          každé záložky
    ├── common/                sdílené věci, které používá víc záložek
    │   ├── zaklad.js            $ helper, formátování čísel, adresy API,
    │   │                        sdílený stav appky (načtená data, filtry...)
    │   ├── dataLoader.js        tlačítko "Načíst data" - stáhne VŠECHNA data
    │   ├── pivotTable.js        vykreslování stromové tabulky - používá ho
    │   │                        jak Týdenní, tak Roční přehled (proto je tu)
    │   ├── highlight.js         zvýraznění řádku/sloupce/buňky myší
    │   └── filters.js           okénko filtru u sloupců Kategorie/Disponent
    ├── grafy/
    │   └── pareto.js           vše pro záložku "Grafy" (Pareto graf)
    ├── tydenni-prehled/
    │   └── weekly.js           co je specifické jen pro Týdenní přehled
    │                           (checkboxy "Potřeby") - tabulku samotnou
    │                           vykresluje common/pivotTable.js
    ├── rocni-prehled/
    │   └── yearly.js           totéž pro Roční přehled
    └── empties/
        └── empties.js          vše pro záložku "Empties" (načtení, editace,
                                 přidání řádku)
```

**Proč jsou `pivotTable.js`, `highlight.js` a `filters.js` ve
`common/`, a ne třeba ve `tydenni-prehled/`?** Protože stejný kód
vykresluje/ovládá jak Týdenní, tak Roční přehled - je to jeden sdílený
"engine" pro obě tabulky, ne kód specifický jen pro jednu záložku.

### 9.2 `server/` - backend (6 souborů)

```
server.js                vstupní bod - spustí appku (`node server.js`)
server/
├── nastaveni.js          VŠECHNA nastavení appky na jednom místě (adresa
│                         shared-api, cesta k Pythonu, port...)
├── sql-dotazy.js         JEDINÉ místo se skutečným SQL textem - odsud
│                         appka posílá dotazy do shared-api
├── shared-api-klient.js  malá funkce spustitDotaz() - pošle dotaz na
│                         shared-api a vrátí výsledek
├── pomocne-funkce.js     cache, ETag hlavičky, rozpoznání období
│                         ("CW 12/2026"), sestavení stromové (pivot) tabulky
└── api-routes.js         VŠECHNY webové adresy appky (/api/pckpoolbalance,
                          /api/weekly-overview, /api/pareto, /api/empties,
                          /api/load-source...) v jednom souboru
```

Detailnější technický popis přístupu k datům je v bodě 3 výše a v
`../../shared-api/README.md`.
