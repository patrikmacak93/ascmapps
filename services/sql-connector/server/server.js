// server.js
// Hlavní vstupní bod connectoru. Vytvoří Express app, nastaví
// middlewary a napojí routes. Žádnou konkrétní logiku endpointů
// tady nehledej — ta je v routes/ + controllers/.

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const config = require('./config')
const logger = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');
const apiKeyAuth = require('./middleware/apiKeyAuth');
const errorHandler = require('./middleware/errorHandler');
const { getHealth, getHealthDb } = require('./controllers/healthController');
const outboundPnzRoutes = require('./routes/outboundPnz');

const app = express();

// --- Logování požadavků ---
// MUSÍ být jeden z úplně prvních middlewarů, ať zaloguje i požadavky,
// které později skončí na apiKeyAuth (401) nebo jinde.
app.use(requestLogger);

// Základní bezpečnostní HTTP hlavičky.
app.use(helmet());

// Povolí CORS — pro začátek otevřené pro všechny (*),
// v produkci omezit na konkrétní domény klientů.
app.use(cors());

// Parsuje JSON tělo požadavků (potřeba pro POST/PUT endpointy).
app.use(express.json());

// --- Health check endpointy ---
// Zůstávají BEZ ověření API klíče — monitoring nástroje (nebo load
// balancer) potřebují zjistit stav serveru bez nutnosti znát tajný
// klíč. Proto jsou zaregistrované PŘED apiKeyAuth middlewarem.
app.get('/health', getHealth);
app.get('/health/db', getHealthDb);

// --- Ověření API klíče ---
// Od tohoto řádku dál PLATÍ pro všechny následující routy.
app.use(apiKeyAuth);

// --- Napojení routes (chráněné API klíčem) ---
const packagingRoutes = require('./routes/packaging');
const paretoRoutes = require('./routes/pareto');
const projectsRoutes = require('./routes/projects');
const emptiesRoutes = require('./routes/empties');
const budgetRoutes = require('./routes/budget');
const agvListRoutes = require('./routes/agvList');
console.log('agvListRoutes loaded:', agvListRoutes);

// Obalová databáze (dřív Node-RED na portu 1884):
//   authRoutes        -> POST /api/v1/login          (dřív /login)
//   pckDatabaseRoutes -> GET/POST/PUT/DELETE /api/v1/pck-database
const authRoutes = require('./routes/auth');
const pckDatabaseRoutes = require('./routes/pckDatabase');

app.use('/api/v1', packagingRoutes);
app.use('/api/v1', paretoRoutes);
app.use('/api/v1', projectsRoutes);
app.use('/api/v1', emptiesRoutes);
app.use('/api/v1', budgetRoutes);
app.use('/api/v1', authRoutes);
app.use('/api/v1', pckDatabaseRoutes);
app.use('/api/v1', agvListRoutes);
app.use('/api/v1', outboundPnzRoutes);

// Až přibudou další skupiny endpointů, přidají se stejným způsobem:
// const ordersRoutes = require('./routes/orders');
// app.use('/api/v1', ordersRoutes);

// --- Centralizovaný error handler ---
// MUSÍ být zaregistrovaný AŽ NA KONCI, po všech routerech — Express
// pozná error handler podle 4 parametrů (err, req, res, next) a podle
// pozice v řetězci middlewarů.
app.use(errorHandler);

const PORT = config.PORT;

app.listen(PORT, () => {
  logger.info(`Connector běží na http://localhost:${PORT}`);
});

