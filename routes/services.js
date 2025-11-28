const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const servicesController = require('../controllers/servicesController');
const staffController = require('../controllers/staffController');

// Services CRUD and queries
router.get('/', authenticateToken, servicesController.getServices);
router.post('/', authenticateToken, servicesController.saveServices);
router.post('/add', authenticateToken, servicesController.addService);
router.get('/user', authenticateToken, servicesController.getUserServices);
router.put('/:id', authenticateToken, servicesController.updateService);
router.delete('/:id', authenticateToken, servicesController.deleteService);

// Images
router.post('/:serviceId/upload-images', authenticateToken, servicesController.uploadServiceImages);
router.post('/upload-image', authenticateToken, servicesController.uploadServiceImage);
router.delete('/:serviceId/images/:imageIndex', authenticateToken, servicesController.deleteServiceImage);

// Staff services under services path for compatibility
router.get('/staff/:staffId', authenticateToken, staffController.getStaffServices);

module.exports = router;

