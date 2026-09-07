const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson } = require('./canonical.cjs');
const { validateState } = require('./model.cjs');
const Ajv = require('ajv');
const operationSchema = require('../schemas/external-operation.schema.json');
const operationValidator = new Ajv({ allErrors: true }).compile(operationSchema);
function validateOperation(record) { if (!operationValidator(record)) throw new Error(`OPERATION_SCHEMA_INVALID: ${operationValidator.errors.map((error) => error.instancePath || error.keyword).join(',')}`); }

class StateStore {
  constructor(root) { this.root = root; this.statePath = path.join(root, '.workflow-state', 'workflow-state.json'); this.operations = path.join(root, '.workflow-state', 'external-operations'); }
  read() { const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); validateState(state); return state; }
  write(state) { validateState(state); fs.mkdirSync(path.dirname(this.statePath), { recursive: true }); const tmp = `${this.statePath}.${process.pid}.tmp`; fs.writeFileSync(tmp, canonicalJson(state), { encoding: 'utf8' }); fs.renameSync(tmp, this.statePath); }
  reserve(operationKey, record) { validateOperation(record); fs.mkdirSync(this.operations, { recursive: true }); const file = path.join(this.operations, `${operationKey}.json`); try { const fd = fs.openSync(file, 'wx'); fs.writeFileSync(fd, canonicalJson(record)); fs.closeSync(fd); return { acquired: true, record }; } catch (error) { if (error.code !== 'EEXIST') throw error; const existing = JSON.parse(fs.readFileSync(file, 'utf8')); validateOperation(existing); return { acquired: false, record: existing }; } }
  readOperation(operationKey) { return JSON.parse(fs.readFileSync(path.join(this.operations, `${operationKey}.json`), 'utf8')); }
  update(operationKey, patch) { fs.mkdirSync(this.operations, { recursive: true }); const file = path.join(this.operations, `${operationKey}.json`); const current = JSON.parse(fs.readFileSync(file, 'utf8')); const next = { ...current, ...patch, operation_key: operationKey, updated_at: new Date().toISOString() }; validateOperation(next); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, canonicalJson(next), { encoding: 'utf8' }); fs.renameSync(tmp, file); return next; }
}
module.exports = { StateStore };
