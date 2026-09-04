import { fileURLToPath } from 'node:url';
import { validateProduct } from '../src/validation.js';
const result = await validateProduct(fileURLToPath(new URL('../fixtures/sample-product/', import.meta.url)));
if (!result.ok) {
  console.error(JSON.stringify({ ok: false, errors: result.errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(`fixture valid: ${result.state.project_id}`);
}

