/**
 * Shared byte/crypto helpers for Web Bot Auth (verifier + `imrobot/agent` signer).
 * Web Crypto only, zero dependencies. Internal module.
 */

/** Public Ed25519 JWK (RFC 8037). */
export interface Ed25519PublicJwk {
  kty: 'OKP'
  crv: 'Ed25519'
  x: string
  kid?: string
  use?: string
  alg?: string
  nbf?: number
  exp?: number
}

/** Private Ed25519 JWK (RFC 8037): the public members plus `d`. */
export interface Ed25519PrivateJwk extends Ed25519PublicJwk {
  d: string
}

/** UTF-8 encode into an ArrayBuffer-backed view (avoids SharedArrayBuffer typing). */
export function utf8Bytes(str: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder().encode(str)
  const out = new Uint8Array(enc.byteLength)
  out.set(enc)
  return out
}

/** Decode standard or URL-safe base64 (padding optional). Throws on bad input. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const std = b64.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(std)) throw new Error('invalid base64')
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Standard base64 with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/** Unpadded base64url. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data))
}

/**
 * RFC 7638 JWK SHA-256 thumbprint, base64url (RFC 8037 A.3 for OKP keys).
 * This is the `keyid` Web Bot Auth requires.
 */
export async function jwkThumbprint(jwk: {
  kty?: string
  crv?: string
  x?: string
}): Promise<string> {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    throw new Error('jwkThumbprint: only Ed25519 OKP keys are supported')
  }
  // Required members only, lexicographic order, no whitespace (RFC 7638 3.2).
  const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${jwk.x}"}`
  return bytesToBase64Url(await sha256(utf8Bytes(canonical)))
}

/** Constant-time comparison of two ASCII strings. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/** RFC 9530 `Content-Digest` value for a body: `sha-256=:<base64>:`. */
export async function contentDigest(body: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof body === 'string' ? utf8Bytes(body) : body
  return `sha-256=:${bytesToBase64(await sha256(bytes))}:`
}

/**
 * Public keys that are published test keys (RFC 9421 B.1.4 test-key-ed25519,
 * RFC 8037 A.1). draft-ietf-webbotauth-httpsig-protocol-01 6.8: verifiers
 * SHOULD reject them in production.
 */
export const KNOWN_TEST_KEY_X = new Set([
  'JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs',
  '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
])
