const express = require('express');
const router = express.Router();
const { getParetoPotreba, getParetoNakoupeno } = require('../controllers/paretoController');

router.get('/pareto/potreba', getParetoPotreba);
router.get('/pareto/nakoupeno', getParetoNakoupeno);

module.exports = router