

const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const levelName = process.env.LOG_LEVEL || 'info';
const threshold = levels[levelName] || levels.info;
const enabled = String(process.env.LOG_ENABLED || 'true').toLowerCase();
const isEnabled = !['false', '0', 'off', 'no'].includes(enabled);



function normalizeMeta(meta) {
    if (!meta) return undefined;
    if (meta instanceof Error) {
        // Hata nesnesini konsola anlamlı bir şekilde yazmak için
        return { name: meta.name, message: meta.message, stack: meta.stack };
    }
    if (typeof meta === 'object') return meta;
    return { detail: String(meta) };
}

function write(level, msg, meta) {
    if (!isEnabled) return;
    
    // Log objesi konsol için oluşturuluyor
    const entryObj = {
        time: new Date().toISOString(),
        level,
        msg,
        meta: normalizeMeta(meta)
    };
    
    let line;
    try {
        // Konsola JSON formatında yaz (Vercel log sistemi için en iyisi)
        line = JSON.stringify(entryObj);
    } catch (_) {
        line = JSON.stringify({ time: entryObj.time, level, msg, error: 'Meta serialization failed' });
    }

    // Dosya yazma (stream.write) yerine console.log kullan
    if (level === 'error') {
        console.error(line);
    } else if (level === 'warn') {
        console.warn(line);
    } else {
        console.log(line);
    }
}

const logger = {
    // Threshold kontrolü ve write fonksiyonunu çağırma mantığı aynı kaldı
    debug(msg, meta) { if (isEnabled && threshold <= levels.debug) write('debug', msg, meta); },
    info(msg, meta) { if (isEnabled && threshold <= levels.info) write('info', msg, meta); },
    warn(msg, meta) { if (isEnabled && threshold <= levels.warn) write('warn', msg, meta); },
    error(msg, meta) { if (isEnabled && threshold <= levels.error) write('error', msg, meta); }
};

module.exports = logger;
