import { createApi } from '../cloud-functions/_lib/api.js';

export function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function serviceFailure() {
  return secureResponse(Response.json({ error: '服务请求失败，请稍后重试' }, {
    status: 500, headers: { 'Cache-Control': 'no-store' },
  }));
}

export function createCloudflareApi(options = {}) {
  // Secrets come only from the current platform bindings, never build-time
  // process.env or the local-development anonymous-AI exception.
  const handle = createApi({ ...options, env: {}, allowLocalAi: false });
  return async context => {
    try { return secureResponse(await handle(context)); }
    catch { return serviceFailure(); }
  };
}

export const handleApi = createCloudflareApi();
