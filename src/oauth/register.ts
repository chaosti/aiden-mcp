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

  // Basic validation: each redirect_uri must be a parseable URL with https://
  // (or http://localhost for development). We're permissive — Claude provides
  // its own callback URI, not us.
  for (const uri of body.redirect_uris) {
    try {
      const parsed = new URL(uri);

      // Protocol check: must be https or localhost
      if (parsed.protocol !== "https:" && !uri.startsWith("http://localhost")) {
        return jsonError("invalid_redirect_uri", `Redirect URI must be https or localhost: ${uri}`, 400);
      }

      // Prevent suspicious patterns that could bypass validation
      if (uri.includes('javascript:') || uri.includes('data:') || uri.includes('file:')) {
        return jsonError("invalid_redirect_uri", `Invalid redirect URI scheme: ${uri}`, 400);
      }

      // For https URIs, validate hostname structure
      if (parsed.protocol === "https:") {
        if (!parsed.hostname.match(/^[\w\-\.]+$/)) {
          return jsonError("invalid_redirect_uri", `Invalid hostname in redirect URI: ${uri}`, 400);
        }

        // Prevent IP addresses (require domain names for https)
        if (parsed.hostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
          return jsonError("invalid_redirect_uri", `HTTPS redirect URIs must use domain names, not IP addresses: ${uri}`, 400);
        }
      }
    } catch {
      return jsonError("invalid_redirect_uri", `Invalid redirect URI: ${uri}`, 400);
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
