import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";

// Stands in for Cloudflare Access during `vite dev`: serves a local signing key
// at the certs endpoint and signs every loopback request in as a local
// organiser, so the Worker runs the same token verification as production.

const TOKEN_HEADER = "cf-access-jwt-assertion";
const KEY_ID = "local-dev";
const RS256 = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
} as const;
const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const localUser = { sub: "local-organiser", email: "organiser@localhost.test" };

export function accessDev({ teamUrl, audience }: { teamUrl: string; audience: string }): Plugin {
  return {
    name: "access-dev",
    apply: "serve",
    async configureServer(server) {
      const keys = await crypto.subtle.generateKey(RS256, true, ["sign", "verify"]);
      const jwks = {
        keys: [{ ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: KEY_ID, alg: "RS256", use: "sig" }],
      };
      server.config.logger.info(`Local Access sign-in: ${localUser.email}`);

      server.middlewares.use(async (request, response, next) => {
        removeHeader(request, TOKEN_HEADER);
        const path = (request.url ?? "/").split("?")[0];

        if (path === "/cdn-cgi/access/certs") {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(jwks));
          return;
        }
        if (path === "/cdn-cgi/access/logout") {
          // Local dev has a single always-signed-in user; there is no session to end.
          response.statusCode = 302;
          response.setHeader("Location", "/");
          response.end();
          return;
        }
        if (loopbackAddresses.has(request.socket.remoteAddress ?? "")) {
          const token = await sign(keys.privateKey, { teamUrl, audience });
          request.headers[TOKEN_HEADER] = token;
          request.rawHeaders.push(TOKEN_HEADER, token);
        }
        next();
      });
    },
  };
}

async function sign(privateKey: CryptoKey, { teamUrl, audience }: { teamUrl: string; audience: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: KEY_ID, typ: "JWT" };
  const payload = { ...localUser, aud: [audience], iss: teamUrl, iat: now, nbf: now, exp: now + 3600 };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(RS256, privateKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(signature)}`;
}

function base64Url(value: string | ArrayBuffer): string {
  return Buffer.from(typeof value === "string" ? value : new Uint8Array(value)).toString("base64url");
}

function removeHeader(request: IncomingMessage, name: string): void {
  delete request.headers[name];
  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) request.rawHeaders.splice(index, 2);
  }
}
