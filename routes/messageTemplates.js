const express = require('express');
const router = express.Router();

const User = require('../models/User');
const { authenticateToken } = require('../middlewares/auth');

// Mesaj şablonlarını getir
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    const userWithTemplates = await User.findById(req.user.userId).select('messageTemplates');
    const templates = userWithTemplates?.messageTemplates || [];
    res.json({ success: true, templates });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mesaj şablonlarını kaydet
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { templates } = req.body;
    if (!Array.isArray(templates)) {
      return res.status(400).json({ error: 'Şablonlar array formatında olmalıdır' });
    }

    await User.findByIdAndUpdate(
      req.user.userId,
      { messageTemplates: templates },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Mesaj şablonları başarıyla kaydedildi',
      templates
    });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;
