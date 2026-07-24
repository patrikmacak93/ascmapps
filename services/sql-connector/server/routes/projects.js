const express = require('express');
const router = express.Router ();
const { getProjects } = require('../controllers/projectsController');

router.get('/projects', getProjects);

module.exports = router