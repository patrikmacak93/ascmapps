<<<<<<< HEAD
# ASCM_apps - přehled

Sada interních reportovacích webových appek pro jednotlivá oddělení.
Plán je mít jeden rozdělovník (hlavní stránku s tlačítky), odkud se
otevírají jednotlivé appky - tahle složka je základ pro to.

## Struktura

```
ASCM_apps/
├── shared-api/            sdílené SQL API (2 soubory - config.js + server.js).
│                          Appky mu posílají SQL dotaz (text) + parametry,
│                          ono ho spustí v databázi a vrátí výsledek.
│                          Viz shared-api/README.md.
└── Packaging/
    └── pck_forecast/      appka "Packaging pool management Dashboard"
                           (dřív pckPool report) - čte/zapisuje data
                           přes shared-api. Viz Packaging/pck_forecast/README.md.
```

## Jak to zapadá dohromady

```
prohlížeč appky  →  backend appky (server.js dané appky)  →  shared-api  →  SQL databáze
```

- Appka (její vlastní `server/`) si nechává business logiku
  specifickou pro sebe (grafy, pivot tabulky, spojování dat...) a
  svoje SQL dotazy v jednom souboru (u pck_forecast je to
  `server/sql-dotazy.js`).
- **Přístup k SQL databázi** mají všechny appky společný, přes
  `shared-api` - appka mu pošle text SQL dotazu + parametry, ono ho
  spustí a vrátí výsledek. Přístupové údaje k databázi jsou tak jen
  na jednom místě (`shared-api/config.js`).

## Jak přidat další appku

1. Appka si data bere přes `shared-api` (`POST /api/query` s tělem
   `{ "sql": "...", "params": {...} }`) - viz `shared-api/README.md`,
   hlavně bezpečnostní poznámku o parametrech.
2. Appka si SQL dotazy, které používá, drží ve vlastním souboru
   (podle vzoru `Packaging/pck_forecast/server/sql-dotazy.js`).
3. Appku umísti do vlastní podsložky podle oddělení (např.
   `ASCM_apps/<Oddělení>/<appka>/`), stejně jako `Packaging/pck_forecast`.
4. Appka se nasazuje jako samostatná IIS/iisnode aplikace, stejně jako
   `pck_forecast` a `shared-api` (viz `web.config` v obou složkách).
=======
Plan:
1. Centrální úroveň (rozcestník týmů --> appek), API pro čtení a zápis do SQL (zakázat drop table)
2. Definovat finální hosting software
3. Připravit návod integrace následujících appek
>>>>>>> 8894fdf9c69ded22e2bd7a4551d6f17209b019a8
