const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const campaignsController = require('../controllers/campaignsController');

router.get('/', authenticateToken, campaignsController.getCampaigns);
router.post('/', authenticateToken, campaignsController.addCampaign);
router.put('/:id', authenticateToken, campaignsController.updateCampaign);
router.delete('/:id', authenticateToken, campaignsController.deleteCampaign);

module.exports = router;
