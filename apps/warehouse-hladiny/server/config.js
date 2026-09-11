/*
============================================================
NASTAVENI BACKENDU APLIKACE WAREHOUSE-HLADINY
============================================================
Vsechny hodnoty, ktere se lisi server od serveru (adresy, porty,
klice). Zadna logika - jen hodnoty. Kdyz se appka stehuje nebo se
zmeni adresa sql-connectoru, meni se to TADY a nikde jinde.

Proc tenhle backend vubec existuje, kdyz mame sql-connector:
sql-connector se otevira jen na API klic (hlavicka x-api-key).
Kdyby ho volal primo prohlizec, musel by ten klic byt zapsany
v JavaScriptu, ktery si muze kdokoliv na intranetu zobrazit -
a s nim by pak mohl sahnout na VSECHNY endpointy connectoru.
Klic proto zustava tady na serveru, stejne jako u outbound-pnz,
pck_forecast a packaging-database.
*/

'use strict';

module.exports = {
// Na jakem portu posloucha TENTO backend. V provozu ho dodava NSSM
// pres promennou prostredi PORT; IIS na tenhle port jen proxuje.
// Fallback 3300 je jen pro rucni spusteni bez nastaveneho prostredi
// (3200 uz drzi outbound-pnz).
PORT: process.env.PORT || 3300,

// Adresa sql-connectoru + jeho API klic. Stejne hodnoty jako
// v ostatnich appkach - nastavuji se v NSSM pres "Environment".
SQL_CONNECTOR_URL: process.env.PCK_SQL_CONNECTOR_BASE,
SQL_CONNECTOR_API_KEY: process.env.API_KEY,
};
