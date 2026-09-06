const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson } = require('./canonical');
const { validateState } = require('./model');

class StateStore {
  constructor(root) { this.root = root; this.statePath = path.join(root, '.workflow-state', 'workflow-state.json'); this.operations = path.join(root, '.workflow-state', 'external-operations'); }
  read() { const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); validateState(state); return state; }
  write(state) { validateState(state); fs.mkdirSync(path.dirname(this.statePath), { recursive: true }); const tmp = `${this.statePath}.${process.pid}.tmp`; fs.writeFileSync(tmp, canonicalJson(state), { encoding: 'utf8' }); fs.renameSync(tmp, this.statePath); }
  reserve(operationKey, record) { fs.mkdirSync(this.operations, { recursive: true }); const file = path.join(this.operations, `${operationKey}.json`); try { const fd = fs.openSync(file, 'wx'); fs.writeFileSync(fd, canonicalJson(record)); fs.closeSync(fd); return { acquired: true, record }; } catch (error) { if (error.code !== 'EEXIST') throw error; return { acquired: false, record: JSON.parse(fs.readFileSync(file, 'utf8')) }; } }
}
module.exports = { StateStore };
