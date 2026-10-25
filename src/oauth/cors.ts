/**
 * CORS configuration for OAuth endpoints.
 *
 * Explicit CORS headers to prevent unauthorized cross-origin access while
 * allowing legitimate OAuth clients to complete the authorization flow.
 */

const ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://www.claude.ai",
];

/**
 * Get CORS headers for OAuth endpoints.
 * Only allows registered Claude.ai origins for security.
 */
export function getCorsHeaders(origin: string | null): HeadersInit {
  // Only allow specific origins for OAuth endpoints
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400", // 24 hours
    };
  }

  // No CORS headers for unauthorized origins
  return {};
}

/**
 * Handle OPTIONS preflight requests for OAuth endpoints.
 */
export function handleCorsPreflightRequest(request: Request): Response | null {
  if (request.method !== "OPTIONS") {
    return null;
  }

  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    // Reject preflight from unauthorized origins
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/**
 * Add CORS headers to a response if the request origin is allowed.
 */
export function addCorsHeaders(response: Response, request: Request): Response {
  const origin = request.headers.get("Origin");
  const corsHeaders = getCorsHeaders(origin);

  if (Object.keys(corsHeaders).length === 0) {
    // No CORS headers to add
    return response;
  }

  // Clone response and add CORS headers
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
