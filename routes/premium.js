const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const premiumController = require('../controllers/premiumController');

router.get('/status', authenticateToken, premiumController.status);
router.post('/activate', authenticateToken, premiumController.activate);

module.exports = router;

