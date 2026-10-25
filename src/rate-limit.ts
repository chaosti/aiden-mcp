/**
 * Rate limiting using Cloudflare Workers KV.
 *
 * Prevents brute force attacks on OAuth endpoints by limiting requests
 * per IP address or email hash within a sliding time window.
 */

import { Env, sha256Hex } from "./oauth/kv.js";

const RATE_LIMIT_PREFIX = "ratelimit:";
const WINDOW_SECONDS = 300; // 5 minutes
const MAX_ATTEMPTS = 10; // 10 attempts per 5 minutes

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp when limit resets
}

/**
 * Check if a request is within rate limits.
 *
 * @param env Cloudflare Workers environment
 * @param key Unique identifier for the rate limit (e.g., "auth:emailhash:ip")
 * @returns RateLimitResult indicating if request is allowed
 */
export async function checkRateLimit(
  env: Env,
  key: string
): Promise<RateLimitResult> {
  const rlKey = `${RATE_LIMIT_PREFIX}${key}`;
  const now = Math.floor(Date.now() / 1000);

  // Get current count from KV
  const record = await env.AIDEN_OAUTH.get(rlKey);
  const current = record ? parseInt(record, 10) : 0;

  if (current >= MAX_ATTEMPTS) {
    // Rate limit exceeded
    return {
      allowed: false,
      remaining: 0,
      resetAt: now + WINDOW_SECONDS
    };
  }

  // Increment counter
  await env.AIDEN_OAUTH.put(
    rlKey,
    String(current + 1),
    { expirationTtl: WINDOW_SECONDS }
  );

  return {
    allowed: true,
    remaining: MAX_ATTEMPTS - current - 1,
    resetAt: now + WINDOW_SECONDS
  };
}

/**
 * Generate rate limit key for authentication attempts.
 * Combines email hash and IP for granular limiting.
 */
export async function authRateLimitKey(email: string, ip: string): Promise<string> {
  const emailHash = await sha256Hex(email.toLowerCase());
  // Take first 16 chars of hash for shorter keys
  return `auth:${emailHash.slice(0, 16)}:${ip}`;
}

/**
 * Generate rate limit key for token endpoint.
 */
export function tokenRateLimitKey(ip: string): string {
  return `token:${ip}`;
}

/**
 * Generate rate limit key for client registration.
 */
export function registerRateLimitKey(ip: string): string {
  return `register:${ip}`;
}
