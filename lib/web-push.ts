// Web Push with WebCrypto only: VAPID signing (RFC 8292) and aes128gcm payload encryption (RFC 8291).
// This module has no imports, so the server and the tests can share it as it is.
export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string };

export const VAPID_SUBJECT = 'https://prithvifc.ca';
// The Worker POSTs to a subscription's endpoint, so only the browsers' push services are accepted.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
const BASE64URL = /^[A-Za-z0-9_-]+$/;
// One record holds the whole payload; this is its size, and payloads stay far below it.
const RECORD_SIZE = 4096;
const encoder = new TextEncoder();

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1024 || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && PUSH_HOSTS.some(host => host.test(url.hostname));
}

// A subscription's keys: the device's P-256 public key (65 bytes, uncompressed) and its 16-byte auth secret.
export function isPushKeys(p256dh: unknown, auth: unknown): boolean {
  return typeof p256dh === 'string' && typeof auth === 'string' && BASE64URL.test(p256dh) && BASE64URL.test(auth)
    && fromBase64url(p256dh).length === 65 && fromBase64url(p256dh)[0] === 4 && fromBase64url(auth).length === 16;
}

// Sends one encrypted message; resolves to the push service's HTTP status.
export async function sendPush(target: PushTarget, message: object, keys: VapidKeys, ttlSeconds: number): Promise<number> {
  const response = await fetch(target.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuthorization(target.endpoint, keys), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttlSeconds), Urgency: 'normal' },
    body: await encrypt(encoder.encode(JSON.stringify(message)), target),
  });
  return response.status;
}

async function vapidAuthorization(endpoint: string, keys: VapidKeys) {
  const publicKey = fromBase64url(keys.publicKey);
  const signingKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: base64url(publicKey.slice(1, 33)), y: base64url(publicKey.slice(33, 65)), d: keys.privateKey },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (value: object) => base64url(encoder.encode(JSON.stringify(value)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT });
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${base64url(signature)}, k=${keys.publicKey}`;
}

async function encrypt(payload: Uint8Array<ArrayBuffer>, target: PushTarget) {
  const deviceKey = fromBase64url(target.p256dh), authSecret = fromBase64url(target.auth);
  const server = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const serverKey = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey) as ArrayBuffer);
  const device = await crypto.subtle.importKey('raw', deviceKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: device }, server.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hmac(await hmac(authSecret, shared), concat(encoder.encode('WebPush: info\0'), deviceKey, serverKey, [1]));
  const prk = await hmac(salt, ikm);
  const contentKey = (await hmac(prk, concat(encoder.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(encoder.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  // The single, last record ends with the 0x02 delimiter.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(payload, [2])));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = serverKey.length;
  return concat(header, serverKey, ciphertext);
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const hmacKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, data));
}

function concat(...parts: (Uint8Array | number[])[]) {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), char => char.charCodeAt(0));
}
