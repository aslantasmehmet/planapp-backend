// api/index.js dosyasının TAMAMI:

const app = require('../server'); // Dikkat: '../server' kullanıyoruz çünkü server.js bir üstte

module.exports = (req, res) => {
  return app(req, res);
};
