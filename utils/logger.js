const fs = require('fs');
const path = require('path');

const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const levelName = process.env.LOG_LEVEL || 'info';
const threshold = levels[levelName] || levels.info;
const enabled = String(process.env.LOG_ENABLED || 'true').toLowerCase();
const isEnabled = !['false', '0', 'off', 'no'].includes(enabled);

const baseLogDir = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
try {
  fs.mkdirSync(baseLogDir, { recursive: true });
} catch (_) {}

const maxSizeMB = Number(process.env.LOG_MAX_SIZE_MB || 10);
const MAX_BYTES = (isFinite(maxSizeMB) && maxSizeMB > 0) ? maxSizeMB * 1024 * 1024 : 10 * 1024 * 1024;

let currentDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
let fileIndex = 0;
let stream = null;
let bytesWritten = 0;

function filePathFor(date, index) {
  const suffix = index > 0 ? `-${index}` : '';
  return path.join(baseLogDir, `app-${date}${suffix}.log`);
}

function openStream(date, index) {
  const filePath = filePathFor(date, index);
  try {
    stream = fs.createWriteStream(filePath, { flags: 'a' });
    try {
      const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      bytesWritten = stat ? stat.size : 0;
    } catch (_) {
      bytesWritten = 0;
    }
  } catch (_) {
    stream = { write: () => {} };
    bytesWritten = 0;
  }
}

openStream(currentDate, fileIndex);

function normalizeMeta(meta) {
  if (!meta) return undefined;
  if (meta instanceof Error) {
    return { name: meta.name, message: meta.message, stack: meta.stack };
  }
  if (typeof meta === 'object') return meta;
  return { detail: String(meta) };
}

function rotateIfNeeded(entryLength) {
  const nowDate = new Date().toISOString().slice(0, 10);
  if (nowDate !== currentDate) {
    currentDate = nowDate;
    fileIndex = 0;
    try { stream.end && stream.end(); } catch (_) {}
    openStream(currentDate, fileIndex);
    return;
  }
  bytesWritten += entryLength;
  if (bytesWritten >= MAX_BYTES) {
    fileIndex += 1;
    try { stream.end && stream.end(); } catch (_) {}
    openStream(currentDate, fileIndex);
  }
}

function write(level, msg, meta) {
  if (!isEnabled) return;
  const entryObj = {
    time: new Date().toISOString(),
    level,
    msg,
    meta: normalizeMeta(meta)
  };
  let line;
  try {
    line = JSON.stringify(entryObj) + '\n';
  } catch (_) {
    line = JSON.stringify({ time: entryObj.time, level, msg }) + '\n';
  }
  try {
    rotateIfNeeded(Buffer.byteLength(line));
    stream.write(line);
  } catch (_) {}
}

const logger = {
  debug(msg, meta) { if (isEnabled && threshold <= levels.debug) write('debug', msg, meta); },
  info(msg, meta) { if (isEnabled && threshold <= levels.info) write('info', msg, meta); },
  warn(msg, meta) { if (isEnabled && threshold <= levels.warn) write('warn', msg, meta); },
  error(msg, meta) { if (isEnabled && threshold <= levels.error) write('error', msg, meta); }
};

module.exports = logger;
