const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const auth = require('../controllers/authController');

router.post('/register', auth.register);
router.post('/register-init', auth.registerInit);
router.post('/register-verify', auth.registerVerify);
router.post('/login', auth.login);
router.post('/verify-otp', auth.verifyOtp);
router.get('/profile', authenticateToken, auth.profile);

module.exports = router;

