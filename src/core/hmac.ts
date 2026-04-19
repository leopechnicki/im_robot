/**
 * HMAC-SHA256 using Web Crypto API — zero dependencies.
 * Works in browsers, Node.js 15+, Deno, Bun, Cloudflare Workers.
 *
 * All functions are async because Web Crypto is async by design.
 */

const encoder = new TextEncoder()

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Compute HMAC-SHA256 of a message with the given secret.
 * Returns a 64-char lowercase hex string.
 */
export async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await getCryptoKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return bufferToHex(signature)
}

/**
 * Verify an HMAC-SHA256 signature in constant time.
 *
 * Uses a constant-time comparison that does NOT short-circuit on length
 * mismatch, preventing timing-based side-channel attacks.
 */
export async function hmacVerify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(secret, message)

  // Pad the shorter string so we always compare `expected.length` characters.
  // The length difference is folded into `result` to avoid short-circuiting.
  const maxLen = Math.max(expected.length, signature.length)
  let result = expected.length ^ signature.length // non-zero if lengths differ
  for (let i = 0; i < maxLen; i++) {
    result |= (expected.charCodeAt(i) || 0) ^ (signature.charCodeAt(i) || 0)
  }
  return result === 0
}

/**
 * Compute SHA-256 hash of a string. Returns 64-char lowercase hex.
 * Used for challenge answer hashing (agent doesn't need the secret).
 */
export async function sha256(message: string): Promise<string> {
  const data = encoder.encode(message)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return bufferToHex(hash)
}
