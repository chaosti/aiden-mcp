/**
 * Redirect URI allowlist for OAuth clients.
 *
 * Registration is open (RFC 7591 — Claude registers itself), so without an
 * allowlist anyone could register their own redirect URI and send the user a
 * link to this server's genuine sign-in page; signing in would deliver an
 * auth code for the user's Aidens to the attacker. Restricting redirects to
 * Claude's callback (and loopback, where a code never leaves the user's own
 * machine) closes that.
 *
 * Checked at registration AND at /oauth/authorize, so client records already
 * stored in KV before this check existed are covered too.
 */

// Claude's hosted connector callback (claude.ai web, desktop and mobile apps).
const CLAUDE_CALLBACK_HOSTS = new Set(["claude.ai", "claude.com"]);
const CLAUDE_CALLBACK_PATH = "/api/mcp/auth_callback";

// Loopback, for local clients such as Claude Code. Compared against the
// parsed hostname — a prefix check would accept http://localhost.evil.com.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;

  if (parsed.protocol === "https:") {
    return CLAUDE_CALLBACK_HOSTS.has(parsed.hostname) && parsed.pathname === CLAUDE_CALLBACK_PATH;
  }
  if (parsed.protocol === "http:") {
    return LOOPBACK_HOSTS.has(parsed.hostname);
  }
  return false;
}
