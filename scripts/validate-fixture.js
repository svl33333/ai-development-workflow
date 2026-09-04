import { fileURLToPath } from 'node:url';
import { validateProduct } from '../src/validation.js';
const result = await validateProduct(fileURLToPath(new URL('../fixtures/sample-product/', import.meta.url)));
console.log(`fixture valid: ${result.state.project_id}`);
