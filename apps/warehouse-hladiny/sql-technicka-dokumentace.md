# Výpočet skladových hladin – technická dokumentace SQL

Referenční dokument k datové a výpočetní vrstvě v MSSQL. Navazuje na
`ARCHITEKTURA_hladiny.md` (ta popisuje *co a proč*); tento dokument popisuje
*přesně jak* – objekty, datové typy, kontrakty importu a výpočetní logiku na
úrovni implementace. Určeno pro vývoj a údržbu, ne pro zákazníka.

Frontend a schvalovací UI jsou budoucí krok a nejsou zde.

---

## 1. Prostředí a inventář objektů

| | |
|---|---|
| Server | `FSDB0005\I0176` |
| Databáze | `FSTASCM` |
| Schéma | `skladyHladiny` |

Konvence názvů: `schema.tabulka` bez pomlček (pomlčka by v MSSQL vynutila
hranaté závorky u každého odkazu). Schéma je camelCase v souladu se stávajícími
(`pckForecast`, `outbound`). Klíč materiálu je vždy **surové SAP číslo
`Material`** – join potřeby ⇄ hladiny funguje přímo, ověřeno na datech;
`compute_mod_pn` se nepoužívá.

### Objekty a jejich zdrojové soubory

| Objekt | Typ | Zdroj / skript |
|---|---|---|
| `skladyHladiny.aktualni_hladiny` | tabulka (import) | `01_schema_hladiny.sql` |
| `skladyHladiny.potreby` | tabulka (import) | `01_schema_hladiny.sql` |
| `skladyHladiny.nove_hladiny` | tabulka (import) | `01_schema_hladiny.sql` |
| `skladyHladiny.vyjimky_mrtvol` | tabulka (ruční) | `01_schema_hladiny.sql` |
| `skladyHladiny.vypocet_hladin` | tabulka (výstup) | `01_schema_hladiny.sql` + `04_export_sap.sql` |
| `skladyHladiny.export_sap` | tabulka (export) | `04_export_sap.sql` |
| `skladyHladiny.usp_vypocet_hladin` | procedura | `02_vypocet_hladin.sql` |
| `skladyHladiny.usp_export_hladiny` | procedura | `04_export_sap.sql` |
| importér (watcher + parsery) | Python | `hladiny_watch.py`, `03_potreby_import_delta.py` |

### Obecné konvence

- **Plný refresh.** Importní tabulky se při každém vložení reportu přepíšou celé
(`DELETE` + `INSERT` v jedné transakci). Žádný merge, žádné delty.
- **`loaded_at`** u každé importní tabulky = čas nahrání dávky.
- **Množstevní typ** je jednotně `DECIMAL(18)`.
- `aktualni_hladiny` se **výpočtem nikdy nepřepisuje** – zůstává obrazem SAPu
a mění se až příštím importem, jakmile SAP nové hladiny převezme.

---

## 2. Importní kontrakt (report → tabulka)

Tři SAP ALV exporty (.htm/.HTML) se ručně vkládají do sledované složky; watcher
je naimportuje plným refreshem. Parsery jsou v `03_potreby_import_delta.py`,
kostra (watch / wait_until_stable / `get_engine` / DELETE+INSERT) se přebírá
z `dco_watch.py`.

### 2.1 `ASCM_Hladiny.HTML` → `aktualni_hladiny`

Hlavička reportu: `Plant, Material, Storage Type, VALUE, XMOVE`.

- Každý `Material` je v reportu právě 1× (závod `0001`) → klíč = `material`.
- `VALUE` → `current_level` (aktuální hladina).
- `Storage Type` je jen atribut (kde zásoba leží), není součást klíče.
- `XMOVE` se **neimportuje** (příznak, pro výpočet nepotřebný).
- Parser bere data až po řádku, jehož první buňka je `Plant`.

### 2.2 `Job_ASCM_FST_WH_LVL__Step_1.htm` → `potreby`

Hlavička: `Material, Backlog, W 37/2026 … W 01/2027` (18 týdenních sloupců).

Dvě klíčové odchylky oproti standardnímu importu:

1. **`Backlog` se ignoruje a neimportuje.** Důsledek: materiál, který je
v reportu jen s backlogem, po jeho zahození vyjde jako nulový → spadne mezi
mrtvoly (stejně jako úplně prázdné materiály).
2. **Ukládá se všech 18 týdnů pro každý materiál, i prázdné jako `0`.** Jinak by
materiál s nulovou poptávkou z tabulky zmizel a nešel by odlišit od „není
v reportu". Prázdná buňka → `requirement_qty = 0`.

Report se rozpadá do dlouhého formátu: jeden řádek = jeden materiál × jeden týden.
`period_index = 0` je **nejbližší** týden (první týdenní sloupec), `period_label`
se skládá jako `"cw <týden>/<rok>"` a slouží jen ke čtení.

> **period_index = 0:** je aktuální týden kdy report vznikl
> Čtyřtýdenní okno sloužící pro výpočet jsou indexy 1-4.

### 2.3 `Job_ASCM_NEW_HLADINY__Step_1.htm` → `nove_hladiny`

Hlavička: `Plnt, Typ, Material, Total stock, BUn, Typ, ZFST_WM_SMT-VALUE`.

- Report má **ALV smetí před hlavičkou** (Sort criteria, Data statistics,
Records passed, Calculated total records). Parser čeká, až narazí na řádek
s první buňkou přesně `Plnt`, a teprve pak bere data.
- Datové řádky mají `Plnt = "*"` (ALV subtotal marker) – nebrat jako plant,
a řádky s `Material = "*"` přeskočit.
- Evidence materiálů bez nastavené hladiny. Ve výpočtu se použijí jen ty, které
jsou zároveň v `potreby`; zbytek se ve výpočtu vynechá. Tabulka slouží spíš
jako kontrola.

---

## 3. DDL tabulek

### 3.1 `aktualni_hladiny` — PK `(material)`

| Sloupec | Typ | Null | Poznámka |
|---|---|---|---|
| `material` | `VARCHAR(40)` | NE | PK |
| `plant` | `VARCHAR(10)` | ANO | |
| `storage_type` | `VARCHAR(10)` | ANO | atribut, ne klíč |
| `current_level` | `DECIMAL(18)` | NE | sloupec `VALUE` z reportu |
| `loaded_at` | `DATETIME2(0)` | NE | |

### 3.2 `potreby` — PK `(material, period_index)`

| Sloupec | Typ | Null | Poznámka |
|---|---|---|---|
| `material` | `VARCHAR(40)` | NE | PK |
| `period_index` | `TINYINT` | NE | 0..17, 0 = nejbližší týden; PK |
| `period_label` | `VARCHAR(20)` | NE | `"cw 37/2026"`, jen pro čtení |
| `requirement_qty` | `DECIMAL(18,3)` | NE | prázdná buňka uložena jako `0` |
| `loaded_at` | `DATETIME2(0)` | NE | |

Index: `IX_potreby_idx (period_index) INCLUDE (requirement_qty)` – covering
index pro filtr prvních 4 týdnů ve výpočtu.

### 3.3 `nove_hladiny` — PK `(material)`

| Sloupec | Typ | Null | Poznámka |
|---|---|---|---|
| `material` | `VARCHAR(40)` | NE | PK |
| `plant` | `VARCHAR(10)` | ANO | `"*"`/prázdné → NULL |
| `storage_type` | `VARCHAR(10)` | ANO | |
| `total_stock` | `DECIMAL(18)` | ANO | |
| `base_unit` | `VARCHAR(10)` | ANO | |
| `loaded_at` | `DATETIME2(0)` | NE | |

### 3.4 `vyjimky_mrtvol` — PK `(material)` · ruční údržba

| Sloupec | Typ | Null | Poznámka |
|---|---|---|---|
| `material` | `VARCHAR(40)` | NE | PK |
| `poznamka` | `NVARCHAR(200)` | ANO | |
| `created_at` | `DATETIME2(0)` | NE | DEFAULT `SYSDATETIME()` |

Materiál bez požadavků, který se **nemá nulovat**. Ve výpočtu mu místo `0`
zůstane aktuální hladina.

### 3.5 `vypocet_hladin` — PK `(run_at, material)` · výstup výpočtu

Plní se **přírůstkově** – každý běh přidá novou sadu řádků s vlastním `run_at`,
takže zůstává historie/audit.

| Sloupec | Typ | Null | Poznámka |
|---|---|---|---|
| `run_at` | `DATETIME2(0)` | NE | čas běhu; PK |
| `material` | `VARCHAR(40)` | NE | PK |
| `current_level` | `DECIMAL(18)` | ANO | hladina před výpočtem |
| `q3` | `DECIMAL(18,3)` | ANO | výsledná (2denní) hladina z kvartilu |
| `pct_change` | `DECIMAL(9,4)` | ANO | `(q3 − current)/current` |
| `new_level` | `DECIMAL(18)` | ANO | výsledek; `NULL` = nenastaveno |
| `action_label` | `NVARCHAR(60)` | NE | slovní důvod |
| `approved_at` | `DATETIME2(0)` | ANO | doplněno `04_export_sap.sql` |
| `approved_by` | `NVARCHAR(128)` | ANO | doplněno `04_export_sap.sql` |
| `exported_at` | `DATETIME2(0)` | ANO | doplněno `04_export_sap.sql` |

Poslední tři sloupce přidává `04_export_sap.sql` idempotentně
(`IF COL_LENGTH(...) IS NULL ALTER TABLE ... ADD ...`).

### 3.6 `export_sap` — PK `(export_at, material)`

| Sloupec | Typ | Null | Poznámka |
|---|---|---|---|
| `export_at` | `DATETIME2(0)` | NE | čas exportu; PK |
| `material` | `VARCHAR(40)` | NE | PK |
| `new_level` | `DECIMAL(18)` | NE | |
| `action_label` | `NVARCHAR(60)` | NE | |
| `run_at` | `DATETIME2(0)` | NE | z kterého běhu řádek pochází |

> Layout je **minimální** (`material` + `new_level` + kontext). Přesné
> názvy/pořadí sloupců, co loader do SAPu čeká (závod, jednotka, typ pohybu),
> je potřeba potvrdit s tím, kdo hladiny do SAPu zavádí, a podle toho doladit.

---

## 4. Výpočetní procedura `usp_vypocet_hladin`

```
EXEC skladyHladiny.usp_vypocet_hladin [@band = 0.20];
```

Parametr `@band DECIMAL(5,4)` = šířka pásma (default `0.20` = ±20 %).

Celý rozhodovací strom je jeden `INSERT … SELECT` nad CTE. `run_at` je jeden
`SYSDATETIME()` pro celý běh.

### 4.1 Řídící množina a CTE

- **Řídící množina = `SELECT DISTINCT material FROM potreby`.** Materiály, které
v potřebách nejsou, se **vynechají** – procedura na ně vůbec nesahá a jejich
aktuální hladina zůstává.
- `cur` – aktuální hladina na materiál z `aktualni_hladiny`.
- `live` – živost: `MAX(CASE WHEN requirement_qty <> 0 THEN 1 ELSE 0 END)` přes
**všech 18 týdnů** → `has_demand`.
- `q3` – kvartil ze **4 týdnů**: `PERCENTILE_DISC(0.75) WITHIN GROUP (ORDER BY
requirement_qty)` s filtrem `period_index < 4 AND requirement_qty > 0`
(nuly i záporné se před kvartilem vyhazují).
- `base` – spojení výše + `is_exception` z `vyjimky_mrtvol`.

### 4.2 Kvartil a přepočet na 2 dny

`PERCENTILE_DISC(0.75)` vrací **skutečnou existující hodnotu** z nenulových
týdenních požadavků nejbližších 4 týdnů (ne interpolaci) – „spíš vyšší z běžných
týdenních potřeb". Tato týdenní hodnota se přepočítává na **2denní hladinu**
faktorem `× 2/7` a zaokrouhluje **nahoru** (`CEILING`). Výsledek nese sloupec
`q3` (a při skutečné změně i `new_level`).

> Příklad: týdenní Q3 = 68 900 → `68900 × 2/7 = 19 685,7` → `CEILING` = **19 686**.

### 4.3 Rozhodovací strom (shora, první platná větev vyhrává)

| # | Podmínka | `new_level` | `action_label` |
|---|---|---|---|
| 1 | `has_demand = 0` a **není** ve výjimkách | `0` | `Mrtvý materiál` |
| 2 | `has_demand = 0` a **je** ve výjimkách | `current_level` | `Bez požadavků, ve výjimkách` |
| 3b | `current_level IS NULL` a `q3 IS NULL` | `NULL` | `Nový – bez blízké poptávky` |
| 3 | `current_level IS NULL` (má poptávku) | `q3` (bez pásma) | `Nový materiál` |
| 4 | `q3 IS NULL` (živý, má hladinu, 4 t. prázdné) | `current_level` | `Beze změny (bez blízké poptávky)` |
| 5a | `q3 > current × (1 + @band)` | `q3` | `Navýšeno` |
| 5b | `q3 < current × (1 − @band)` | `q3` | `Poníženo` |
| 6 | uvnitř pásma | `current_level` | `Beze změny` |

`pct_change = (q3 − current_level) / current_level`, počítá se jen když
`current_level > 0` a `q3 IS NOT NULL`.

Pozn.: „mrtvola" pokrývá i materiál, který byl v reportu jen s backlogem –
backlog se neimportuje, takže mu nezůstane žádný nenulový týden.

### 4.4 Výstup procedury

Po `INSERT` procedura vrátí přehled posledního běhu – jen řádky, kde se něco
mění a hladina je nastavená:

```sql
WHERE run_at = @run
AND new_level IS NOT NULL
AND (new_level <> current_level OR current_level IS NULL)
ORDER BY action_label, material;
```

---

## 5. Schvalovací a exportní vrstva (`usp_export_hladiny`)

Nic se nepřepisuje zpět do `aktualni_hladiny`. Tok je: **výpočet → ruční
schválení (UPDATE) → export do `export_sap`**.

### 5.1 Schválení (ruční)

Celý poslední běh:

```sql
UPDATE skladyHladiny.vypocet_hladin
SET approved_at = SYSDATETIME(), approved_by = SUSER_SNAME()
WHERE run_at = (SELECT MAX(run_at) FROM skladyHladiny.vypocet_hladin)
AND approved_at IS NULL;
```

Výběrově: do `WHERE` přidat kritérium (např. `AND ABS(pct_change) < 5`) nebo
vyjmenovat materiály. Cílově tuto akci nahradí frontend.

### 5.2 Export

```
EXEC skladyHladiny.usp_export_hladiny;
```

Vybere řádky `approved_at IS NOT NULL AND exported_at IS NULL AND new_level IS
NOT NULL AND (current_level IS NULL OR new_level <> current_level)`, vloží je do
`export_sap` s jedním `export_at`, označí zdrojové řádky `exported_at` a vrátí,
co poslal.

**Neexportuje se:** `Beze změny` a `Nový – bez blízké poptávky` (`new_level`
NULL). **Exportují se** skutečné změny včetně mrtvol (srážka na `0`).

---

## 6. Provozní pořadí

**Jednorázově (založení):**
`01_schema_hladiny.sql` → `02_vypocet_hladin.sql` → `04_export_sap.sql`.

**Každý cyklus:**
1. Vložit tři reporty do sledované složky (watcher naimportuje plným refreshem).
2. `EXEC skladyHladiny.usp_vypocet_hladin;`
3. Zkontrolovat návrh ve `vypocet_hladin` (poslední `run_at`).
4. Schválit (ruční `UPDATE approved_at`) – celý běh, nebo výběr.
5. `EXEC skladyHladiny.usp_export_hladiny;`
6. Z `export_sap` uložit CSV pro SAP (SSMS *Save Results As* → CSV, nebo `bcp`).

> **Pořadí je závazné:** nejdřív všechny tři importy (plný refresh), teprve pak
> výpočet – ten čte hotová, čerstvá data.

---

## 7. Otevřené technické body

- **Layout `export_sap`** – potvrdit přesné sloupce/formát, které SAP loader
očekává, a doladit tabulku i proceduru.
- **Stálost `period_index`** – ověřit na dalším exportu, že se týdenní okno
posouvá.
- **`nove_hladiny`** – většina jeho materiálů (cizí formát čísel) není
v potřebách → ve výpočtu se vynechají; pro jejich zpracování by byla nutná
cross-reference na forecastová čísla.
- **Přesnost `DECIMAL(18,3)`** – hladiny jsou fakticky celočíselné (`CEILING`),
desetinná část vychází `.000`. Pokud padne rozhodnutí sloupce převést na bez
desetinných míst, upravit typ v `01_schema_hladiny.sql` a v obou procedurách
konzistentně.
