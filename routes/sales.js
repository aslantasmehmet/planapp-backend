const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const salesController = require('../controllers/salesController');

router.post('/', authenticateToken, salesController.createSale);
router.get('/customer/:id', authenticateToken, salesController.getSalesByCustomer);
router.get('/:saleId/details', authenticateToken, salesController.getSaleDetails);

router.get('/:saleId/installments', authenticateToken, salesController.getInstallments);
router.post('/:saleId/installments', authenticateToken, salesController.createInstallment);
router.put('/installments/:installmentId', authenticateToken, salesController.updateInstallment);

router.get('/:saleId/sessions', authenticateToken, salesController.getSessions);
router.post('/:saleId/sessions/init', authenticateToken, salesController.initSessions);
router.post('/:saleId/sessions', authenticateToken, salesController.createSession);
router.put('/sessions/:sessionId', authenticateToken, salesController.updateSession);
router.post('/sessions/reminders/run', authenticateToken, salesController.runSessionReminders);

router.put('/:saleId', authenticateToken, salesController.updateSale);
router.delete('/:saleId', authenticateToken, salesController.deleteSale);

module.exports = router;
