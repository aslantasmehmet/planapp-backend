const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middlewares/auth');
const paymentsController = require('../controllers/paymentsController');

router.get('/customer/:customerId', authenticateToken, paymentsController.getPaymentsByCustomer);
router.post('/', authenticateToken, paymentsController.createPayment);
router.put('/:paymentId', authenticateToken, paymentsController.updatePayment);
router.delete('/:paymentId', authenticateToken, paymentsController.deletePayment);

module.exports = router;
