const express = require('express')
const router = express.Router();
const { getPackaging } = require('../controllers/packagingController');

router.get('/packaging', getPackaging);

module.exports = router