const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token gerekli' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Geçersiz token' });
      }
      req.user = user;
      next();
    });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

module.exports = { authenticateToken };
