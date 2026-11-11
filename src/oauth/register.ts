/**
 * Dynamic Client Registration (RFC 7591).
 *
 * Claude POSTs here when adding a custom connector. We accept reasonable
 * client metadata, generate a client_id, and store the registration in KV.
 *
 * No client_secret issued — Claude uses PKCE for security on the auth-code
 * exchange instead. This is the "public client" pattern.
 */

import { Env, putClient, generateRandomToken } from "./kv.js";
import { checkRateLimit, registerRateLimitKey } from "../rate-limit.js";
import { isAllowedRedirectUri } from "./redirect.js";

interface RegistrationRequest {
  redirect_uris?: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
}

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  // Rate limiting: prevent client registration spam
  const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const rateLimitKey = registerRateLimitKey(clientIp);
  const rateLimit = await checkRateLimit(env, rateLimitKey);

  if (!rateLimit.allowed) {
    return jsonError(
      "too_many_requests",
      "Rate limit exceeded. Please try again later.",
      429
    );
  }

  let body: RegistrationRequest;
  try {
    body = (await request.json()) as RegistrationRequest;
  } catch {
    return jsonError("invalid_client_metadata", "Body must be JSON", 400);
  }

  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return jsonError("invalid_redirect_uri", "redirect_uris is required", 400);
  }

  // Only Claude's callback and loopback are accepted — see redirect.ts.
  for (const uri of body.redirect_uris) {
    if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
      return jsonError(
        "invalid_redirect_uri",
        "Redirect URI not allowed: only Claude's connector callback or a loopback (localhost) address",
        400,
      );
    }
  }

  const client_id = `aiden_${generateRandomToken(16)}`;
  const created_at = Date.now();

  await putClient(env, {
    client_id,
    client_name: body.client_name?.slice(0, 200),
    redirect_uris: body.redirect_uris,
    token_endpoint_auth_method: body.token_endpoint_auth_method ?? "none",
    created_at,
  });

  return Response.json(
    {
      client_id,
      client_id_issued_at: Math.floor(created_at / 1000),
      redirect_uris: body.redirect_uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: body.client_name,
    },
    { status: 201 },
  );
}

function jsonError(error: string, error_description: string, status = 400): Response {
  return Response.json({ error, error_description }, { status });
}
