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
     API_BASE: "http://localhost:3200/api"
   =========================================================================== */

window.APP_CONFIG = {
  API_BASE: "./api",
};