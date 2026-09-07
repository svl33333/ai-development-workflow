const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');
const { StateStore } = require('./state-store.cjs');
const root = path.resolve(__dirname, '..');
function validateFixtures() { const ajv = new Ajv({ allErrors: true }); const schemaDir = path.join(root, 'schemas'); let count = 0; for (const file of fs.readdirSync(schemaDir).filter((f) => f.endsWith('.json'))) { const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8')); const validate = ajv.compile(schema); const fixtureDir = path.join(root, 'fixtures', 'issue-10'); if (fs.existsSync(fixtureDir)) for (const fixture of fs.readdirSync(fixtureDir).filter((f) => f.endsWith('.json'))) { const value = JSON.parse(fs.readFileSync(path.join(fixtureDir, fixture), 'utf8')); if (schema.$id && value.$schema_id === schema.$id) { const payload = { ...value }; delete payload.$schema_id; if (!validate(payload)) throw new Error(`${file}: ${fixture}: ${ajv.errorsText(validate.errors)}`); count += 1; } } } return count; }
const command = process.argv[2];
if (command === 'status') { let state; try { state = new StateStore(root).read(); } catch { state = { status: 'uninitialized', target_revision: null }; } console.log(process.argv.includes('--json') ? JSON.stringify(state) : state.status); }
else if (command === 'validate-fixtures') { console.log(`validated ${validateFixtures()} fixture(s)`); }
else { console.error('Usage: node src/cli.js status --json | validate-fixtures'); process.exitCode = 2; }
