/*
============================================================
NASTAVENI BACKENDU APLIKACE AGV-UTILIZATION
============================================================
Vsechny hodnoty, ktere se lisi server od serveru (adresy, porty,
klice). Zadna logika - jen hodnoty.

API klic k sql-connectoru zustava TADY na serveru (z promenne
prostredi), nikdy ne v JavaScriptu v prohlizeci - stejne jako
u ostatnich appek.
*/

'use strict';

module.exports = {
// Port TOHOTO backendu. V provozu ho dodava NSSM pres promennou
// prostredi PORT; IIS na nej jen proxuje (/agvUtilization/*).
// Fallback 3400 (3300 drzi warehouse-hladiny).
PORT: process.env.PORT || 3400,

// Adresa sql-connectoru + jeho API klic. Stejne hodnoty jako
// v ostatnich appkach - nastavuji se v NSSM pres "Environment".
SQL_CONNECTOR_URL: process.env.PCK_SQL_CONNECTOR_BASE,
SQL_CONNECTOR_API_KEY: process.env.API_KEY,
};
