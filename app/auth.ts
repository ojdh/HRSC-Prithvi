import { env } from "cloudflare:workers";
import { headers } from "next/headers";

// Identity comes from Cloudflare Access, which sits in front of the Worker and
// forwards a signed JWT on every request. The token is verified here; any
// other identity header is ignored. See
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

export type ClubUser = {
  userId: string;
  email: string;
  displayName: string;
};

type AccessConfig = { teamUrl: string; audience: string };
type SigningKeys = { teamUrl: string; fetchedAt: number; keys: Map<string, CryptoKey> };

const TOKEN_HEADER = "cf-access-jwt-assertion";
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const KEY_CACHE_MS = 60 * 60 * 1000;
// A token with an unknown key id triggers a refetch (Access rotates keys), but
// no more than once a minute so forged key ids cannot flood the certs endpoint.
const KEY_REFETCH_MS = 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

let signingKeys: SigningKeys | null = null;

export async function getUser(): Promise<ClubUser | null> {
  const config = accessConfig();
  const token = (await headers()).get(TOKEN_HEADER);
  if (!token) return null;

  const claims = await verifyAccessToken(token, config);
  if (!claims) return null;
  return { userId: claims.sub, email: claims.email, displayName: claims.email };
}

// Access protects the whole site, so navigating to any page starts sign-in
// when the session has lapsed.
export function signInPath(returnTo: string): string {
  return safeRelativeReturnPath(returnTo);
}

function accessConfig(): AccessConfig {
  const vars = env as unknown as Record<string, string | undefined>;
  const teamUrl = vars.CF_ACCESS_TEAM_URL;
  const audience = vars.CF_ACCESS_AUD;
  if (!teamUrl || !audience) {
    throw new Error(
      "Cloudflare Access is not configured: set CF_ACCESS_TEAM_URL and CF_ACCESS_AUD for this Worker.",
    );
  }
  return { teamUrl: new URL(teamUrl).origin, audience };
}

async function verifyAccessToken(
  token: string,
  { teamUrl, audience }: AccessConfig,
): Promise<{ sub: string; email: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson(encodedHeader);
  const payload = decodeJson(encodedPayload);
  const signature = decodeBase64Url(encodedSignature);
  if (!header || !payload || !signature?.length) return null;
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const key = await signingKey(teamUrl, header.kid);
  if (!key) return null;
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  if (!(await crypto.subtle.verify(RS256, key, signature, signed))) return null;

  const now = Date.now() / 1000;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== teamUrl || !audiences.includes(audience)) return null;
  if (typeof payload.exp !== "number" || payload.exp <= now - CLOCK_SKEW_SECONDS) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + CLOCK_SKEW_SECONDS) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (typeof payload.email !== "string" || !payload.email) return null;

  return { sub: payload.sub, email: payload.email };
}

async function signingKey(teamUrl: string, kid: string): Promise<CryptoKey | null> {
  const age = signingKeys?.teamUrl === teamUrl ? Date.now() - signingKeys.fetchedAt : Infinity;
  const known = age < KEY_CACHE_MS ? signingKeys?.keys.get(kid) : undefined;
  if (known) return known;
  if (age < KEY_REFETCH_MS) return null;

  signingKeys = { teamUrl, fetchedAt: Date.now(), keys: await fetchSigningKeys(teamUrl) };
  return signingKeys.keys.get(kid) ?? null;
}

async function fetchSigningKeys(teamUrl: string): Promise<Map<string, CryptoKey>> {
  const certsUrl = `${teamUrl}/cdn-cgi/access/certs`;
  const response = await fetch(certsUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Cloudflare Access signing keys from ${certsUrl}: HTTP ${response.status}`);
  }
  const { keys } = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const imported = new Map<string, CryptoKey>();
  for (const jwk of keys ?? []) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    imported.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, RS256, false, ["verify"]));
  }
  return imported;
}

function decodeJson(segment: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(segment);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function decodeBase64Url(segment: string): Uint8Array<ArrayBuffer> | null {
  // A length of 1 mod 4 is not valid base64 and would make atob throw.
  if (!/^[A-Za-z0-9_-]*$/.test(segment) || segment.length % 4 === 1) return null;
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
