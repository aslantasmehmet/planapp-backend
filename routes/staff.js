const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const staffController = require('../controllers/staffController');

// Staff CRUD
router.post('/', authenticateToken, staffController.createStaff);
router.get('/', authenticateToken, staffController.listStaff);
router.put('/:id', authenticateToken, staffController.updateStaff);
router.put('/:id/working-hours', authenticateToken, staffController.updateStaffWorkingHours);
router.delete('/:id', authenticateToken, staffController.deleteStaff);

// Avatar
router.post('/:id/upload-avatar', authenticateToken, staffController.uploadStaffAvatar);
router.delete('/:id/avatar', authenticateToken, staffController.deleteStaffAvatar);

// Staff services
router.post('/:staffId/services', authenticateToken, staffController.addStaffService);
router.delete('/:staffId/services/:serviceId', authenticateToken, staffController.deleteStaffService);

module.exports = router;
