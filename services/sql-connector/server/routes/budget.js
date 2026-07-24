const express = require('express');
const router = express.Router();
const { getBudget } = require('../controllers/budgetController')

router.get('/budget', getBudget);

module.exports = router