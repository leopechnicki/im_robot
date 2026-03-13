/**
 * Vitest setup — polyfill globalThis.crypto for Node 18.
 *
 * Node 18 shipped globalThis.crypto as *experimental*; it isn't always
 * present when Vitest runs in the "node" environment.  Node 20+ and
 * browsers expose it natively, so this shim is a no-op there.
 */
import { webcrypto } from 'node:crypto'

if (typeof globalThis.crypto === 'undefined') {
  // @ts-expect-error -- webcrypto is API-compatible with the Web Crypto spec
  globalThis.crypto = webcrypto
}
