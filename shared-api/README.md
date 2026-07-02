# ASCM Shared API

## 1. Co to je

Jedno malé sdílené API pro celou firmu, přes které appky čtou a
zapisují data v SQL databázi `FSTASCM`. Appka pošle **SQL dotaz
(text) + parametry**, tahle appka ho spustí v databázi a vrátí
výsledek. Žádná appka (ani `pck_forecast`) už sama neotevírá
spojení do databáze - to dělá jen tahle appka.

Celá appka jsou **dva soubory**:

| Soubor | Co v něm je |
|---|---|
| `config.js` | přístupové údaje k databázi, port |
| `server.js` | celá logika - webový server + spojení do SQL + endpoint `/api/query` |

## 2. Jak appka tohle API používá

```
POST /api/query
Content-Type: application/json

{
  "sql": "SELECT * FROM [FSTASCM].[pckForecast].[Empties] WHERE [SAP ID] = @sapId",
  "params": { "sapId": "12345" }
}
```

Odpověď:

```json
{ "rows": [ { "EmptiesID": 1, "SAP ID": "12345", ... } ], "rowsAffected": 1 }
```

- **`sql`** - text SQL dotazu. Píše ho appka, která volá shared-api
  (typicky ho má appka pohromadě v jednom svém souboru - u
  `pck_forecast` je to `server/sql-dotazy.js`).
- **`params`** - hodnoty pro pojmenované parametry v dotazu
  (`@sapId` apod.). **Vždycky se sem dávají proměnlivé hodnoty**,
  nikdy se nevkládají přímo do textu `sql` - viz bezpečnostní
  poznámka níže.

## 3. Bezpečnost - jak se to má používat správně

Tohle API spustí jakýkoliv SQL text, který mu appka pošle - **nekontroluje**,
jestli appka smí sáhnout na danou tabulku nebo sloupec. Bezpečnost
stojí na dvou věcech:

1. **Appky mají svoje SQL dotazy napevno v kódu** (na serveru, ne v
   prohlížeči) - nejde o to, že by uživatel appky mohl do prohlížeče
   napsat vlastní SQL a poslat ho sem. Appka posílá jen předem
   připravené dotazy ze svého vlastního souboru.
2. **Hodnoty se posílají jako `params`, ne vlepené do `sql`.** Když
   appka staví text dotazu, hodnotu od uživatele (např. co napsal do
   formuláře) NIKDY nevkládá přímo do textu SQL - vždycky použije
   pojmenovaný parametr (`@neco`) a hodnotu pošle v `params`. SQL
   Server pak s parametrem vždycky zachází jako s obyčejnou hodnotou,
   nikdy ne jako se součástí příkazu - to je ochrana proti tzv. SQL
   injection (kdyby někdo do formuláře napsal místo hodnoty kus SQL
   textu a appka ho nechala přímo v dotazu, mohl by tím poškodit nebo
   vykrást databázi).

   ❌ **Špatně** (hodnota vlepená do textu):
   ```js
   const sql = `SELECT * FROM Empties WHERE SAP_ID = '${sapId}'`;
   ```
   ✅ **Správně** (hodnota jako parametr):
   ```js
   const sql = `SELECT * FROM Empties WHERE SAP_ID = @sapId`;
   spustitDotaz(sql, { sapId });
   ```

Toto shared-api je tedy vhodné pro appky nasazené na interní síti
mezi důvěryhodnými backendy (appka -> shared-api), NE pro
zpřístupnění přímo do internetu nebo pro posílání SQL textu
napsaného koncovým uživatelem.

## 4. Jak appka zavolá shared-api v praxi (příklad z pck_forecast)

```js
// server/sql-dotazy.js - appka si tu drží text dotazů
const SEZNAM_PROJEKTU = `
  SELECT DISTINCT Project
  FROM [FSTASCM].[pckForecast].[vw_APR_PackagingSAP]
  WHERE Project IS NOT NULL AND Project <> ''
  ORDER BY Project
`;

// server/shared-api-klient.js - odešle dotaz na shared-api
const vysledek = await spustitDotaz(SEZNAM_PROJEKTU);
console.log(vysledek.rows); // pole řádků z databáze
```

## 5. Nasazení

Běží jako samostatná appka pod IIS přes `iisnode` (viz `web.config`),
pod Windows účtem s přístupem do SQL databáze `FSTASCM`. Nasazuje se
na jiný port než appky, které ji volají (např. `pck_forecast` běží na
:3443, shared-api na :4443).

```
npm install
npm start
```

Rychlá kontrola, že appka běží: `GET /api/health` → `{"ok":true,...}`
