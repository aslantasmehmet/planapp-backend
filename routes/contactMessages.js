const express = require('express');
const ContactMessage = require('../models/ContactMessage');

const router = express.Router();

// İletişim mesajı oluştur
// POST /api/contact-messages
router.post('/api/contact-messages', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ ok: false, error: 'Mesaj alanı zorunlu' });
    }

    const doc = new ContactMessage({ name, email, phone, message });
    await doc.save();
    return res.status(201).json({ ok: true, id: doc._id });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

module.exports = router;
