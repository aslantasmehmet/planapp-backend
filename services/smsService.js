const https = require('https');
const http = require('http');
const { URL } = require('url');
const { MUTLUCELL } = require('../config');

function sendSmsViaMutlucell({ dest, msg, originator, validFor, sendAt, customId }) {
  return new Promise((resolve) => {
    try {
      if (!MUTLUCELL.USERNAME || !MUTLUCELL.PASSWORD) {
        return resolve({ success: false, error: 'MUTLUCELL credentials missing' });
      }
      const escapeXml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&apos;');
      const sender = originator || MUTLUCELL.ORIGINATOR;
      const validity = validFor || MUTLUCELL.VALIDITY; // dakika
      const useSmsgw = String(MUTLUCELL.API_URL || '').includes('/smsgw-ws/');
      const xml = useSmsgw
        ? (`<?xml version="1.0" encoding="UTF-8"?>` +
           `<smspack ka="${escapeXml(MUTLUCELL.USERNAME)}" pwd="${escapeXml(MUTLUCELL.PASSWORD)}"` +
           (sender ? ` org="${escapeXml(sender)}"` : '') +
           `>` +
             `<mesaj>` +
               `<metin>${escapeXml(msg)}</metin>` +
               `<nums>${escapeXml(dest)}</nums>` +
             `</mesaj>` +
           `</smspack>`)
        : (`<?xml version="1.0" encoding="UTF-8"?>` +
           `<request>` +
             `<authentication>` +
               `<username>${escapeXml(MUTLUCELL.USERNAME)}</username>` +
               `<password>${escapeXml(MUTLUCELL.PASSWORD)}</password>` +
             `</authentication>` +
             `<order>` +
               (sender ? `<sender>${escapeXml(sender)}</sender>` : '') +
               (sendAt ? `<send_date>${escapeXml(sendAt)}</send_date>` : '') +
               (validity ? `<validity>${escapeXml(validity)}</validity>` : '') +
               `<message>` +
                 `<text>${escapeXml(msg)}</text>` +
                 `<receipents>` +
                   `<number>${escapeXml(dest)}</number>` +
                 `</receipents>` +
               `</message>` +
             `</order>` +
           `</request>`);

      let urlObj;
      try { urlObj = new URL(MUTLUCELL.API_URL); } catch (e) {
        return resolve({ success: false, error: 'Invalid MUTLUCELL_API_URL' });
      }
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + (urlObj.search || ''),
        method: 'POST',
        servername: urlObj.hostname,
        rejectUnauthorized: isHttps ? !MUTLUCELL.ALLOW_INSECURE_TLS : undefined,
        headers: {
          'Content-Type': 'text/xml',
          'Accept': '*/*',
          'Content-Length': Buffer.byteLength(xml),
        },
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const isOk = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
          if (isOk) {
            return resolve({ success: true, providerMessageId: String(data || '').trim() });
          }
          return resolve({ success: false, error: String(data || `HTTP_${res.statusCode}`) });
        });
      });
      req.on('error', (e) => resolve({ success: false, error: e.message }));
      req.write(xml);
      req.end();
    } catch (err) {
      return resolve({ success: false, error: err.message });
    }
  });
}

function sendSms(params) {
  return sendSmsViaMutlucell(params);
}

module.exports = { sendSms, sendSmsViaMutlucell };

