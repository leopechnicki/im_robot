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
 */
export async function hmacVerify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(secret, message)
  if (expected.length !== signature.length) return false
  // Constant-time comparison to prevent timing attacks
  let result = 0
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
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
