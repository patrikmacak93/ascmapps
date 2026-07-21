// utils/pckDatabaseSloupce.js
// Jediné místo, kde je popsaný vztah mezi sloupci v tabulce dbo.pckDatabase
// a názvy polí, se kterými pracuje frontend (Packaging Database).
//
// Dřív bylo tohle mapování ROZDĚLENÉ do tří různých function nodů v Node-RED
// (add / edit / rename) a každý používal trochu jiné názvy — proto musel
// frontend posílat při zakládání záznamu jiné klíče než při editaci.
// Teď je mapování jedno jediné a platí pro čtení i zápis.
//
// DŮLEŽITÉ: názvy sloupců pro SQL se NIKDY neberou z požadavku klienta,
// vždy jen z tohohle seznamu (whitelist). Díky tomu se do dotazu nemůže
// dostat nic, co tady není — to je základ ochrany proti SQL injection
// u částí dotazu, které se nedají parametrizovat (názvy sloupců).

'use strict';

// Plný název tabulky. Pokud tabulka není ve schématu dbo, uprav tady.
const TABULKA = '[FSTASCM].[dbo].[pckDatabase]';

// Pořadí v tomhle poli = pořadí sloupců, které dostane frontend v JSONu
// (a tedy i pořadí sloupců v tabulce na stránce Search).
//   app = název pole v appce (klíč v JSONu)
//   db  = skutečný název sloupce v databázi
const POLE = [
  { app: 'ID', db: 'ID' },

  // --- Obecné ---
  { app: 'Project', db: 'Project' },
  { app: 'Part Number', db: 'PartNumber' },
  { app: 'Part Name', db: 'PartName' },
  { app: 'Part Weight', db: 'PartWeightKG' },
  { app: 'Usage', db: 'Usage' },
  { app: 'Supplier / Customer', db: 'SupplierCustomer' },
  { app: 'Concept Status', db: 'ConceptStatus' },
  { app: 'Part type', db: 'PartType' },

  // --- P-pack ---
  { app: 'Type of P-pack', db: 'TypeOfPpack' },
  { app: 'P-pack (RE/EX)', db: 'PpackREEX' },
  { app: 'P-pack name', db: 'PpackDescription' },
  { app: 'SAP ID (P-pack)', db: 'SAPIDPpack' },
  { app: 'Ownership (P-pack)', db: 'OwnershipPpack' },
  { app: 'Weight of empty (P-pack)', db: 'WeightOfEmptyPpack' },
  { app: 'Weight of full (P-pack)', db: 'WeightOfFUllPpack' },
  { app: 'Lenght of (P-pack)', db: 'LenghtOfPpack' },
  { app: 'Width of (P-pack)', db: 'WidthOfPpack' },
  { app: 'Height of (P-pack)', db: 'HeightOfPpack' },
  { app: 'Pcs /P-pack', db: 'PcsPerPpack' },
  { app: 'QTY of P-packs in layer on pallet', db: 'QTYOfPpacksInLayerOnPallet' },
  { app: 'QTY of layers /pallet', db: 'QTYOfLayersOnPallet' },
  { app: 'P-pack lid (RE/EX)', db: 'PpackLidREEX' },
  { app: 'P-pack lid name', db: 'PpackLidName' },
  { app: 'P-pack lid weight', db: 'PpackLidWeight' },
  { app: 'QTY of P-pack lids /pallet', db: 'QTYOfPpackLidsOnPallet' },
  { app: 'P-pack lid SAP ID', db: 'PpackLidSAPNo' },

  // --- I-pack (inner packaging) ---
  { app: 'Type of I-pack', db: 'TypeOfInnerPackaging' },
  { app: 'I-pack (RE/EX)', db: 'InnerPackagingREEX' },
  { app: 'I-pack name', db: 'InnerPackagingName' },
  { app: 'I-pack SAP ID', db: 'InnerPackagingSAPno' },
  { app: 'Ownership of I-pack', db: 'InnerPackagingOwnership' },
  { app: 'Empty I-pack weight', db: 'EmptyInnerPackagingWeight' },
  { app: 'Full I-pack weight', db: 'FullInnerPackagingWeight' },
  { app: 'I-pack lenght', db: 'InnerPackagingLenght' },
  { app: 'I-pack width', db: 'InnerPackagingWidth' },
  { app: 'I-pack height', db: 'InnerPackagingHeight' },
  { app: 'Pcs /I-pack', db: 'PcsPerInnerPackaging' },
  { app: 'QTY of I-pack in P-pack', db: 'QTYOfInnerPackagingInsidePpack' },
  { app: 'QTY of layers of I-pack in P-pack', db: 'QTYOfLayersOfInnerPackagingInsidePpack' },
  {
    app: 'Description of add I-packs inside P-pack',
    db: 'DescriptionOfOtherPackagingMaterialInsidePpack',
  },

  // --- Paleta ---
  // POZOR na dvojitou závorku u "Pallet (RE/EX))" — je to překlep, který
  // vznikl v Node-RED rename mapě, ale frontend (pck-edit-form.js) s ním
  // dnes počítá. Až ho budeš chtít opravit, musí se to změnit na obou
  // stranách najednou.
  { app: 'Pallet (RE/EX))', db: 'PalletREEX' },
  { app: 'Pallet name', db: 'PalletName' },
  { app: 'Pallet SAP ID', db: 'PalletSAPNo' },
  { app: 'Empty pallet weight', db: 'EmptyPalletWeight' },
  { app: 'Pallet lenght', db: 'PalletLenght' },
  { app: 'Pallet width', db: 'PalletWidth' },
  { app: 'Empty pallet height', db: 'HeightOfEmptyPallet' },
  { app: 'Full pallet height', db: 'HeightOfFullPallet' },
  { app: 'Pallet lid (RE/EX)', db: 'PalletLidREEX' },
  { app: 'Pallet lid name', db: 'PalletLidDescription' },
  { app: 'Pallet lid SAP ID', db: 'PalletLidSAPNo' },
  { app: 'Pallet lid weight', db: 'PalletLidWeight' },

  // --- PSDS dokument ---
  // V DB sloupec URL1, v tabulce na frontendu hlavička "PSDS".
  { app: 'PSDS', db: 'URL1' },
];

// Sloupce, které se nikdy nezapisují (generuje je databáze).
const JEN_PRO_CTENI = new Set(['ID']);

// SELECT list: [PartNumber] AS [Part Number], ...
// Sestavuje se z whitelistu výše, ne z ničeho, co pošle klient.
const SELECT_LIST = POLE.map(p => `[${p.db}] AS [${p.app}]`).join(',\n         ');

// Mapa pro ZÁPIS: název pole z požadavku -> název sloupce v DB.
const ZAPISOVATELNA_POLE = new Map();
for (const { app, db } of POLE) {
  if (JEN_PRO_CTENI.has(app)) continue;
  ZAPISOVATELNA_POLE.set(app, db);
}

// Formulář posílá PSDS odkaz pod klíčem "URL1" (skryté pole f-URL1),
// zatímco v tabulce se ten samý sloupec jmenuje "PSDS". Přijmeme obojí.
ZAPISOVATELNA_POLE.set('URL1', 'URL1');

/**
 * Z těla požadavku vytáhne jen ta pole, která známe (whitelist), a vrátí
 * je jako pole { db, hodnota } připravené k parametrizovanému dotazu.
 *
 * Prázdný řetězec bereme jako NULL — stejně jako to dělal Node-RED flow.
 * Všechny hodnoty posíláme jako text; číselné sloupce si SQL Server
 * převede sám (implicitní konverze), což je přesně to, co se dělo
 * i dřív, kdy se do dotazu vkládaly hodnoty v apostrofech.
 */
function pripravitPole(telo) {
  const vysledek = [];
  const pouziteSloupce = new Set();

  for (const [klic, hodnota] of Object.entries(telo || {})) {
    const dbSloupec = ZAPISOVATELNA_POLE.get(klic);
    if (!dbSloupec) continue;           // neznámé pole ignorujeme
    if (pouziteSloupce.has(dbSloupec)) continue; // např. URL1 i PSDS naráz
    pouziteSloupce.add(dbSloupec);

    let h = hodnota;
    if (typeof h === 'string') h = h.trim();
    if (h === '' || h === undefined) h = null;

    vysledek.push({ db: dbSloupec, hodnota: h === null ? null : String(h) });
  }

  return vysledek;
}

module.exports = {
  TABULKA,
  POLE,
  SELECT_LIST,
  ZAPISOVATELNA_POLE,
  pripravitPole,
};

