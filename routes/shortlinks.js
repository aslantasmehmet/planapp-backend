const express = require('express');
const crypto = require('crypto');
const config = require('../config');

const router = express.Router();

const SHORTLINK_BASE_URL = config.SHORTLINK_BASE_URL || '';
const shortLinks = new Map();

// Kısaltma oluştur
// POST /api/shorten
router.post('/api/shorten', (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ ok: false, error: 'Geçersiz URL' });
    }
    const id = crypto.randomBytes(4).toString('hex');
    shortLinks.set(id, url);
    const base = SHORTLINK_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const shortUrl = `${base}/r/${id}`;
    return res.json({ ok: true, id, shortUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

// Kısaltmadan yönlendirme
// GET /r/:id
router.get('/r/:id', (req, res) => {
  try {
    const { id } = req.params;
    const target = shortLinks.get(id);
    if (!target) {
      return res.status(404).send('Shortlink bulunamadı');
    }
    return res.redirect(target);
  } catch (error) {
    return res.status(500).send('Sunucu hatası');
  }
});

module.exports = router;
