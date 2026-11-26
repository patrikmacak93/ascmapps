/* ===========================================================================
config.js - nastaveni frontendu AGV Utilization (nacita se PRED app.js)

API_BASE "./api" = backend teto appky na stejne adrese (IIS proxuje
/agvUtilization/* na Node). Pri rucnim spusteni jinde staci prepsat,
napr. "http://localhost:3400/api".
=========================================================================== */

window.APP_CONFIG = {
API_BASE: './api',

// Popisky smen (kody R/N vraci connector). Hranice smen se pocitaji
// v connectoru (SHIFT_START_HOUR v agvUtilizationController.js) -
// tady jsou jen texty do tlacitek a legend.
SHIFTS: {
R: { label: 'Ranní', hours: '6–18' },
N: { label: 'Noční', hours: '18–6' },
},

// Jak se pocita utilizace:
// utilizace = soucet stavu v UTIL_ACTIVE / soucet stavu ve jmenovateli
// Jmenovatel = vsechny stavy KROME UTIL_EXCLUDE (napr. kdyby se Offline
// nemel pocitat do dostupneho casu, dej sem 'offline').
UTIL_ACTIVE: ['activeFull', 'activeEmpty'],
UTIL_EXCLUDE: [],

// Vychozi obdobi pri prvnim otevreni (pocet dni konce dat).
DEFAULT_DAYS: 7,

// Kolik ukolu nejvys stahnout do monitoru (connector ma strop 20000).
ORDER_LIMIT: 20000,
ORDERS_PER_PAGE: 50,
};
