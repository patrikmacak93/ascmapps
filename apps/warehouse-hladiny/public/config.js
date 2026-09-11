/* ===========================================================================
config.js - jedine misto, kde je zapsana adresa API

Musi se nacist PRED app.js:

<script src="./config.js"></script>
<script src="./app.js"></script>

Vychozi "./api" znamena: backend teto appky bezi jako IIS aplikace
ve slozce api/ vedle techhle stranek, tedy na stejne domene
-> zadny CORS, zadne michani http/https.

Kdyby backend bezel jinde (vlastni port pri rucnim `node server.js`,
jiny server), prepis jen tuhle jednu hodnotu na absolutni adresu, napr.:
API_BASE: "http://localhost:3300/api"
=========================================================================== */

window.APP_CONFIG = {
API_BASE: './api',

// Ktere tydenni indexy tvori "vypocetni okno" (zvyraznene v grafu detailu).
// Podle obecneho vysvetleni: report vznika v aktualnim tydnu (index 0),
// pocita se z nasledujicich 4 tydnu -> indexy 1..4. Autoritativni vysledek
// (q3, new_level) vzdy prichazi z DB; tohle ridi jen ZVYRAZNENI v grafu.
WINDOW_START: 1,
WINDOW_LEN: 4,

// Sirka pasma pro rozhodnuti "Beze zmeny" (±20 %). Jen pro vizualni pasmo
// v detailu; skutecne rozhodnuti uz je zapsane v action_label z DB.
BAND: 0.20,
};
