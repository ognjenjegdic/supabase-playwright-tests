import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { expect } from '@playwright/test';
const spec = JSON.parse(readFileSync(new URL('../../docs/openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });
addFormats(ajv);
// OpenAPI 3.0 nullable is supported by Ajv. Unknown documentation keywords are annotations.
ajv.addSchema({ $id: 'restaurant-contract', components: spec.components });
const validators = new Map();
export function assertSchema(name, body) {
  if (!validators.has(name)) validators.set(name, ajv.compile({ $ref: `restaurant-contract#/components/schemas/${name}` }));
  const validate = validators.get(name);
  const valid = validate(body);
  expect(valid, `OpenAPI ${name}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`).toBe(true);
}
