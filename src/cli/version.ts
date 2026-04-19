/**
 * CLI version — dynamically read from package.json at runtime.
 *
 * This ensures `imrobot info` always reflects the published package
 * version without requiring a manual sync step.
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pkg = require('../../package.json') as { version: string }
export const CLI_VERSION: string = pkg.version
