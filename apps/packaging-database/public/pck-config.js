/* ===========================================================================
   pck-config.js — jediné místo, kde je zapsaná adresa API

   Musí se načíst PŘED ostatními pck-* skripty:

     <script src="./pck-config.js"></script>
     <script src="./pck-auth.js"></script>
     ...

   Dřív měl každý skript adresu Node-RED (…:1884) natvrdo u sebe —
   při stěhování se muselo hledat na třech místech. Teď je tu jedna
   konstanta.

   Výchozí "./api" znamená: backend obalové databáze běží jako IIS
   aplikace ve složce api/ vedle těchhle stránek, tedy na stejné doméně
   → žádný CORS, žádné míchání http/https.

   Kdyby backend běžel jinde (vlastní port, jiný server), přepiš jen
   tuhle jednu hodnotu na absolutní adresu, např.:
     API_BASE: "https://fsas00025vma.vt1.vitesco.com:3100"
   =========================================================================== */

   window.PCK_CONFIG = {
    API_BASE: "./api",
  };
  
  