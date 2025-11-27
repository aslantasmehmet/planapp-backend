const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const businessController = require('../controllers/businessController');

router.post('/', authenticateToken, businessController.create);
router.get('/', authenticateToken, businessController.get);
router.put('/', authenticateToken, businessController.update);
router.put('/images', authenticateToken, businessController.updateImages);
router.delete('/delete-images', authenticateToken, businessController.deleteImages);
router.post('/upload-logo', authenticateToken, businessController.uploadLogo);
router.delete('/delete-logo', authenticateToken, businessController.deleteLogo);

module.exports = router;

