const express = require('express');
const router = express.Router ();
const { getProjects, getEmpties, createEmpty, updateEmpty, deleteEmpty } = require('../controllers/emptiesController');

router.get('/empties', getEmpties);
router.post('/empties', createEmpty);
router.put('/empties/:id', updateEmpty)
router.delete('/empties/:id', deleteEmpty)

module.exports = router