import { authenticate, requireRole } from './auth.js';
import { ready } from './startup.js';
import { badRequest, errorResponse } from './util.js';

export { created } from './util.js';

/**
 * Wrap an API function as a Next.js Route Handler.
 *
 * The function receives { user, body, query, params, request } and returns:
 *   - data → 200 JSON, created(data) → 201, nothing → 204, or any Response as-is.
 * Thrown HttpErrors become JSON errors with their status.
 *
 * Options: auth (default true) requires a signed-in user; roles limits it to those roles;
 * json (default true) parses the request body as JSON.
 */
export function handle(fn, { auth = true, roles = null, json = true } = {}) {
  return async (request, context) => {
    try {
      await ready();
      const params = (await context?.params) || {};
      const user = auth ? await authenticate(request) : null;
      if (roles) requireRole(user, ...roles);
      const query = Object.fromEntries(new URL(request.url).searchParams);
      let body = {};
      if (json && !['GET', 'HEAD', 'DELETE'].includes(request.method)) {
        const text = await request.text();
        if (text) {
          try {
            body = JSON.parse(text) ?? {};
          } catch {
            throw badRequest('The request body is not valid JSON');
          }
        }
      }
      const result = await fn({ user, body, query, params, request });
      if (result instanceof Response) return result;
      if (result === undefined) return new Response(null, { status: 204 });
      return Response.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
