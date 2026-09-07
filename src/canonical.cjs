const crypto = require('node:crypto');

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => { out[key] = sortObject(value[key]); return out; }, {});
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(sortObject(value))}\n`;
}

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

module.exports = { sortObject, canonicalJson, sha256 };
