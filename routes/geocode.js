const express = require('express');
const router = express.Router();
const https = require('https');

// Geocoding proxy endpoint - Nominatim
router.get('/api/geocode', async (req, res) => {
  try {
    const { q, city, district } = req.query;
    const base = 'nominatim.openstreetmap.org';
    const queryParams = new URLSearchParams();
    queryParams.set('format', 'json');
    queryParams.set('addressdetails', '1');
    queryParams.set('limit', '5');
    if (city) queryParams.set('city', city);
    if (district) queryParams.set('county', district);
    if (q) queryParams.set('q', q);

    const options = {
      hostname: base,
      port: 443,
      path: `/search?${queryParams.toString()}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Planlyo-Geocode-Proxy',
        'Accept': 'application/json'
      }
    };

    const r = https.request(options, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(data || '[]');
          return res.json(parsed);
        } catch (e) {
          return res.status(500).json({ error: 'parse_failed', message: e.message, raw: data });
        }
      });
    });
    r.on('error', (e) => {
      return res.status(500).json({ error: 'request_failed', message: e.message });
    });
    r.end();
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Reverse geocoding
router.get('/api/reverse-geocode', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat ve lon gerekli' });
    const base = 'nominatim.openstreetmap.org';
    const queryParams = new URLSearchParams();
    queryParams.set('format', 'json');
    queryParams.set('lat', String(lat));
    queryParams.set('lon', String(lon));

    const options = {
      hostname: base,
      port: 443,
      path: `/reverse?${queryParams.toString()}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Planlyo-Geocode-Proxy',
        'Accept': 'application/json'
      }
    };

    const r = https.request(options, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          return res.json(parsed);
        } catch (e) {
          return res.status(500).json({ error: 'parse_failed', message: e.message, raw: data });
        }
      });
    });
    r.on('error', (e) => {
      return res.status(500).json({ error: 'request_failed', message: e.message });
    });
    r.end();
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;
