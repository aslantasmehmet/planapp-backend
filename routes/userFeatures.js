const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middlewares/auth');
const userFeaturesController = require('../controllers/userFeaturesController');

router.get('/me', authenticateToken, userFeaturesController.getMyFeatures);
router.post('/upsert', authenticateToken, userFeaturesController.upsertMyFeature);

module.exports = router;
