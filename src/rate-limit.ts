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
  resetAt: number; // Unix timestamp when limit resets
}

async function attempts(env: Env, key: string): Promise<number> {
  const record = await env.AIDEN_OAUTH.get(`${RATE_LIMIT_PREFIX}${key}`);
  return record ? parseInt(record, 10) : 0;
}

async function recordAttempt(env: Env, key: string, current: number): Promise<void> {
  await env.AIDEN_OAUTH.put(`${RATE_LIMIT_PREFIX}${key}`, String(current + 1), {
    expirationTtl: WINDOW_SECONDS,
  });
}

/**
 * Count this request against the limit and say whether it may proceed.
 *
 * @param key Unique identifier for the rate limit (e.g., "auth:emailhash:ip")
 */
export async function checkRateLimit(env: Env, key: string): Promise<RateLimitResult> {
  const current = await attempts(env, key);
  const resetAt = Math.floor(Date.now() / 1000) + WINDOW_SECONDS;
  if (current >= MAX_ATTEMPTS) return { allowed: false, resetAt };
  await recordAttempt(env, key, current);
  return { allowed: true, resetAt };
}

/**
 * Failure-only limiting, for paths where every request authenticates (so
 * counting successes would throttle normal use). Check before the attempt,
 * record after it fails.
 */
export async function isRateLimited(env: Env, key: string): Promise<boolean> {
  return (await attempts(env, key)) >= MAX_ATTEMPTS;
}

export async function recordFailedAttempt(env: Env, key: string): Promise<void> {
  await recordAttempt(env, key, await attempts(env, key));
}

/**
 * Generate rate limit key for header/Basic credential auth on /mcp. Per IP
 * only, so rotating through emails doesn't reset the budget.
 */
export function headerAuthRateLimitKey(ip: string): string {
  return `headerauth:${ip}`;
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
