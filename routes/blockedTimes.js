const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const ctrl = require('../controllers/blockedTimesController');

router.post('/', authenticateToken, ctrl.create);
router.get('/', authenticateToken, ctrl.list);
router.delete('/:id', authenticateToken, ctrl.remove);

module.exports = router;

