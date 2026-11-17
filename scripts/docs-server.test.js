import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { createDocsServer } from './docs-server.js';

test('docs proxy protects credentials and restricts administrative requests', async t => {
  const key = 'sb_secret_fake_test_value_not_a_real_key';
  const calls = [];
  const server = createDocsServer({
    config: { url: 'https://example.supabase.co', key },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify([{ id: 'demo' }]), { status: 200 });
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(origin)).text();
  const token = html.match(/req.headers\['X-Docs-Token'\]="([a-f0-9]+)"/)[1];
  const spec = await (await fetch(origin + '/openapi.json')).json();
  assert.ok(!html.includes(key));
  assert.ok(!JSON.stringify(spec).includes(key));
  assert.deepEqual(spec.security, []);
  assert.equal(spec.servers[0].url, '/api');
  assert.ok(!spec.components.securitySchemes);
  assert.equal((await fetch(origin + '/swagger-ui-bundle.js')).status, 200);
  assert.equal((await fetch(origin + '/api/restaurants')).status, 403);
  assert.equal((await fetch(origin + '/api/orders', { method: 'DELETE', headers: { 'X-Docs-Token': token } })).status, 400);
  assert.equal((await fetch(origin + '/api/restaurants', { method: 'POST', headers: { 'X-Docs-Token': token } })).status, 405);
  assert.equal((await fetch(origin + '/api/restaurants', { headers: { 'X-Docs-Token': token, Origin: 'https://untrusted.example' } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    get(origin, { headers: { Host: 'untrusted.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(origin + '/api/restaurants?unknown=value', { headers: { 'X-Docs-Token': token } })).status, 400);
  assert.equal(calls.length, 0);
  const response = await fetch(origin + '/api/restaurants?active=eq.true', { headers: { 'X-Docs-Token': token } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ id: 'demo' }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/restaurants?active=eq.true');
  assert.equal(calls[0].options.headers.apikey, key);
  assert.equal(calls[0].options.redirect, 'error');
});
