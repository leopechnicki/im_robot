/**
 * imrobot — Next.js adapter
 *
 * Provides two integration patterns:
 * - `createNextMiddleware()` — App Router: edge/node middleware for global agent verification
 * - `createNextApiHandler()` — Pages Router: API route handler for /api/imrobot
 *
 * @example App Router (middleware.ts at repo root)
 * ```typescript
 * import { createNextMiddleware } from 'imrobot/next'
 *
 * export const middleware = createNextMiddleware({
 *   secret: process.env.IMROBOT_SECRET!,
 *   protectedPaths: ['/api/agent'],
 * })
 *
 * export const config = { matcher: ['/api/agent/:path*', '/imrobot/:path*'] }
 * ```
 *
 * @example Pages Router (pages/api/imrobot.ts)
 * ```typescript
 * import { createNextApiHandler } from 'imrobot/next'
 *
 * export default createNextApiHandler({
 *   secret: process.env.IMROBOT_SECRET!,
 * })
 * ```
 */

export { createNextMiddleware } from './middleware'
export { createNextApiHandler } from './api-handler'
export type { NextMiddlewareConfig, NextApiHandlerConfig } from './types'
