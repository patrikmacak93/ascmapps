/* test-connection.js
Jednorázový skript pro ověření, že se connector opravdu umí připojit k SQL databázi. Nespouští se jako součást API, jen ho použiješ ručně: node test-connection.js
*/

/*Naimportuje poolPromise z db.js. Tím se rovnou spustí i kód v db.js
(Node moduly se cachují, takže se db.js nespustí dvakrát,
i kdyby ho importovalo víc souborů).
*/
const { poolPromise } = require('./db');

// Počká, až se poolPromise vyřeší.
poolPromise
  .then(() => {
    // Spojení se povedlo.
    console.log('Test OK — spojení funguje');
    // Ukončí proces s kódem 0 (v terminálu/skriptech = "úspěch").
    process.exit(0);
  })
  .catch(() => {
    // Spojení selhalo — samotnou chybu už vypsal db.js
    // ve svém vlastním .catch(), tady jen ukončíme proces
    // s kódem 1 ("chyba").
    process.exit(1);
  });

// Proč process.exit()?
// Bez něj by Node.js proces běžel dál, protože otevřený connection
// pool drží proces naživu (čeká na další požadavky). Tenhle skript
// je jen jednorázový test, takže ho po ověření záměrně ukončíme.

