const express = require('express');
const https = require('https');

const router = express.Router();

// Sunucunun egress (dış) IP adresini döndür
// GET /api/public-ip
router.get('/api/public-ip', (req, res) => {
  try {
    https.get('https://api.ipify.org?format=json', (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        try {
          const json = JSON.parse(data);
          return res.json({ ok: true, ip: json.ip });
        } catch (e) {
          return res.status(500).json({ ok: false, error: 'Yanıt çözümlenemedi' });
        }
      });
    }).on('error', (err) => {
      return res.status(500).json({ ok: false, error: err.message });
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

module.exports = router;
