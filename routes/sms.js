const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { sendSmsGeneric } = require('../controllers/appointmentsController');

router.post('/send', authenticateToken, sendSmsGeneric);

module.exports = router;

