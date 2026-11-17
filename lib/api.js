import { request } from '@playwright/test';

export async function apiClient(config) {
  const context = await request.newContext({
    baseURL: config.url,
    timeout: 15_000,
    extraHTTPHeaders: {
      apikey: config.key,
      Accept: 'application/json',
      Prefer: 'return=representation',
    },
  });
  return {
    async send(method, params = {}, data, resource = 'pw_bookings') {
      try {
        return await context.fetch(`/rest/v1/${resource}`, {
          method, params, data,
          // Never forward the secret key on a redirect.
          maxRedirects: 0,
        });
      } catch {
        // Playwright's raw transport errors can include request headers.
        throw new Error(`Supabase ${method} request failed. Check the project status, URL, and network. Header details suppressed.`);
      }
    },
    dispose: () => context.dispose(),
  };
}
