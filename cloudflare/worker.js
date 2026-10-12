import { handleApi, secureResponse, serviceFailure } from './api.js';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api' || path.startsWith('/api/')) return handleApi({ request, env });
    // Most assets bypass the Worker entirely. Unmatched routes still use the
    // asset binding, with no SPA fallback that could turn API errors into HTML.
    try { return secureResponse(await env.ASSETS.fetch(request)); }
    catch { return serviceFailure(); }
  },
};
