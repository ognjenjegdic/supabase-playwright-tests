import SwaggerParser from '@apidevtools/swagger-parser';
import { fileURLToPath } from 'node:url';
const spec = await SwaggerParser.validate(fileURLToPath(new URL('../docs/openapi.json', import.meta.url)));
console.log(`Valid OpenAPI ${spec.openapi}: ${Object.keys(spec.paths).length} paths, ${Object.values(spec.paths).reduce((n,p)=>n+Object.keys(p).length,0)} operations.`);
