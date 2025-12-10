const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const controller = require('../controllers/appointmentsController');

router.get('/', authenticateToken, controller.list);
router.post('/', authenticateToken, controller.create);
router.get('/today', authenticateToken, controller.today);
router.post('/sms/send', authenticateToken, controller.sendSmsGeneric);
router.put('/:id', authenticateToken, controller.update);
router.delete('/:id', authenticateToken, controller.remove);
router.post('/:id/payments', authenticateToken, controller.addPayment);
router.get('/repeats', authenticateToken, controller.listRepeats);
router.get('/repeats/customers', authenticateToken, controller.listRepeatCustomers);
router.put('/repeats/:appointmentId', authenticateToken, controller.updateRepeat);

module.exports = router;
