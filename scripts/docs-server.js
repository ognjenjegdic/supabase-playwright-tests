import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import swaggerUi from 'swagger-ui-dist';
import { settings } from '../lib/config.js';

const specification = JSON.parse(readFileSync(new URL('../docs/openapi.json', import.meta.url), 'utf8'));
const assets = {
  '/swagger-ui.css': ['text/css', 'swagger-ui.css'],
  '/swagger-ui-bundle.js': ['application/javascript', 'swagger-ui-bundle.js'],
};

export function createDocsServer({ config, fetchImpl = fetch }) {
  const token = randomBytes(32).toString('hex');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Restaurant Practice API — Swagger</title><link rel="stylesheet" href="/swagger-ui.css">
    <style>body{margin:0}.notice{font:15px system-ui;padding:16px 24px;background:#fff4d6;color:#302800}</style>
    </head><body><div class="notice"><strong>Live practice database.</strong> Execute creates/deletes demo data.
    Cards are simulated. The local server adds credentials; no API key is needed here.
    Checkout's all-zero order UUID becomes a fresh UUID on every execution.</div>
    <div id="swagger-ui"></div><script src="/swagger-ui-bundle.js"></script><script>
    SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',validatorUrl:null,
      persistAuthorization:false,deepLinking:true,displayRequestDuration:true,
      requestInterceptor:function(req){
        const target=new URL(req.url,location.origin);
        if(target.origin!==location.origin) throw new Error('Only this local docs server is allowed.');
        req.headers['X-Docs-Token']=${JSON.stringify(token)};
        if(target.pathname==='/api/rpc/place_order' && req.body){
          const body=JSON.parse(req.body);
          if(body.p_order_id==='00000000-0000-4000-8000-000000000000'){
            body.p_order_id=crypto.randomUUID();req.body=JSON.stringify(body);
          }
        }
        return req;
      }
    });</script></body></html>`;
  const server = createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      const port = server.address().port;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) {
        return send(403, { message: 'Invalid local host.' });
      }
      if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) {
        return send(403, { message: 'Cross-origin requests are not allowed.' });
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/') return send(200, html, 'text/html');
      if (req.method === 'GET' && url.pathname === '/openapi.json') {
        const localSpec = structuredClone(specification);
        localSpec.servers = [{ url: '/api', description: 'Local authenticated proxy to the practice Supabase project' }];
        localSpec.security = [];
        delete localSpec.components.securitySchemes;
        return send(200, localSpec);
      }
      if (req.method === 'GET' && assets[url.pathname]) {
        const [type, file] = assets[url.pathname];
        return send(200, readFileSync(resolve(swaggerUi.absolutePath(), file)), type);
      }
      if (!url.pathname.startsWith('/api/')) return send(404, { message: 'Not found.' });
      if (req.headers['x-docs-token'] !== token) return send(403, { message: 'Open Swagger locally to use the API proxy.' });
      const path = url.pathname.slice(4);
      const operation = specification.paths[path]?.[req.method.toLowerCase()];
      if (!operation) return send(405, { message: 'This operation is not exposed by the docs proxy.' });
      const allowedParams = new Set((operation.parameters || []).filter(p => p.in === 'query').map(p => p.name));
      if ([...url.searchParams.keys()].some(key => !allowedParams.has(key))) {
        return send(400, { message: 'Undocumented query parameter.' });
      }
      if (req.method === 'DELETE' || req.method === 'PATCH') {
        const filters = url.searchParams.getAll('id');
        if (filters.length !== 1 || !/^eq\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters[0])) {
          return send(400, { message: 'An exact id=eq.<UUID> filter is required.' });
        }
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 16_384) return send(413, { message: 'Request body exceeds 16 KB.' });
      }
      if (body) {
        try { JSON.parse(body); } catch { return send(400, { message: 'Request body must be JSON.' }); }
      }
      const upstream = new URL(`/rest/v1${path}`, config.url);
      upstream.search = url.search;
      const response = await fetchImpl(upstream, {
        method: req.method,
        headers: { apikey: config.key, Accept: 'application/json',
          'Content-Type': 'application/json', Prefer: 'return=representation' },
        ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      const result = (await response.text()).replaceAll(config.key, '[redacted]');
      return send(response.status, result);
    } catch {
      return send(502, { message: 'Request failed. Check the local configuration and Supabase connectivity. Details suppressed.' });
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DOCS_PORT || 3000);
  const server = createDocsServer({ config: settings() });
  server.on('error', () => { console.error('Could not start Swagger. The port may be in use. Set DOCS_PORT to another port.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Swagger UI: http://127.0.0.1:${server.address().port}`));
}
