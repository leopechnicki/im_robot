// Vitest API shim — delegates to the global test runner
const shim = globalThis.__testShim
export const describe = shim.describe
export const it = shim.it
export const expect = shim.expect
