console.log('agvList route file loaded');
const express = require('express');
const router = express.Router();
const getAgvList = require('../controllers/agvListController.js')



router.get('/agvIDs', getAgvList);

module.exports = router