const express = require('express');
const router = express.Router ();
const { getProjects, getEmpties, createEmpty, updateEmpty } = require('../controllers/emptiesController');

router.get('/empties', getEmpties);
router.post('/empties', createEmpty);
router.put('/empties/:id', updateEmpty)

module.exports = router