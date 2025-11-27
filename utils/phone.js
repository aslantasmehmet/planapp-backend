function normalizeMsisdn(ph) {
  try {
    const digits = String(ph).replace(/\D+/g, '');
    if (!digits) return '';
    if (digits.startsWith('0')) return '90' + digits.slice(1);
    return digits;
  } catch (_) {
    return String(ph || '').trim();
  }
}

function maskMsisdn(msisdn) {
  try {
    return String(msisdn).replace(/(\d{2})(\d{3})(\d{2})(\d{2})(\d{2})/, (_, c1, c2, c3, c4, c5) => `${c1}${c2[0]}**${c3}**${c4}${c5 ? '**' : ''}`);
  } catch (_) {
    return null;
  }
}

module.exports = { normalizeMsisdn, maskMsisdn };

