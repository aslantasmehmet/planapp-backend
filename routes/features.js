const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middlewares/auth');
const featuresController = require('../controllers/featuresController');

router.get('/customer/:customerId', authenticateToken, featuresController.getFeaturesByCustomer);
router.post('/', authenticateToken, featuresController.createFeature);
router.put('/:id', authenticateToken, featuresController.updateFeature);
router.post('/upsert', authenticateToken, featuresController.upsertFeatureByKey);

module.exports = router;
