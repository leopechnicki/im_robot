import { describe, it, expect, vi } from 'vitest'
import { buildDiscoveryDocument, createDiscoveryHandler } from '../src/server/discovery'
import type { DiscoveryDocument } from '../src/server/discovery'

// ── buildDiscoveryDocument ──────────────────────────────────────────

describe('buildDiscoveryDocument', () => {
  it('returns a valid document with defaults', () => {
    const doc = buildDiscoveryDocument()

    expect(doc.protocol).toBe('imrobot')
    expect(doc.version).toBe('1.0')
    expect(doc.endpoints.challenge).toBe('/imrobot/challenge')
    expect(doc.endpoints.verify).toBe('/imrobot/verify')
    expect(doc.endpoints.proofHeader).toBe('X-Agent-Proof')
    expect(doc.difficulties).toEqual(['easy', 'medium', 'hard'])
    expect(doc.instructions).toContain('GET the challenge endpoint')
    expect(doc.description).toContain('imrobot')
  })

  it('respects custom challengePath', () => {
    const doc = buildDiscoveryDocument({ challengePath: '/api/v1/auth' })

    expect(doc.endpoints.challenge).toBe('/api/v1/auth/challenge')
    expect(doc.endpoints.verify).toBe('/api/v1/auth/verify')
  })

  it('strips trailing slash from challengePath', () => {
    const doc = buildDiscoveryDocument({ challengePath: '/imrobot/' })

    expect(doc.endpoints.challenge).toBe('/imrobot/challenge')
    expect(doc.endpoints.verify).toBe('/imrobot/verify')
  })

  it('includes optional fields when provided', () => {
    const doc = buildDiscoveryDocument({
      name: 'Test Service',
      description: 'A test agent API',
      contact: 'admin@example.com',
      metadata: { version: '2.0', region: 'us-east-1' },
    })

    expect(doc.name).toBe('Test Service')
    expect(doc.description).toBe('A test agent API')
    expect(doc.contact).toBe('admin@example.com')
    expect(doc.metadata).toEqual({ version: '2.0', region: 'us-east-1' })
  })

  it('omits optional fields when not provided', () => {
    const doc = buildDiscoveryDocument()

    expect(doc.name).toBeUndefined()
    expect(doc.contact).toBeUndefined()
    expect(doc.metadata).toBeUndefined()
  })

  it('allows restricting difficulty levels', () => {
    const doc = buildDiscoveryDocument({ difficulties: ['hard'] })

    expect(doc.difficulties).toEqual(['hard'])
  })

  it('produces valid JSON', () => {
    const doc = buildDiscoveryDocument({
      name: 'JSON Test',
      metadata: { nested: { key: 'value' } },
    })

    const json = JSON.stringify(doc)
    const parsed = JSON.parse(json) as DiscoveryDocument
    expect(parsed.protocol).toBe('imrobot')
    expect(parsed.name).toBe('JSON Test')
  })
})

// ── createDiscoveryHandler ──────────────────────────────────────────

describe('createDiscoveryHandler', () => {
  function createMockRes() {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    }
    return res
  }

  it('returns a function', () => {
    const handler = createDiscoveryHandler()
    expect(typeof handler).toBe('function')
  })

  it('responds with 200 and the discovery document', () => {
    const handler = createDiscoveryHandler({ name: 'Handler Test' })
    const req = { headers: {} }
    const res = createMockRes()

    handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledTimes(1)

    const doc = res.json.mock.calls[0][0] as DiscoveryDocument
    expect(doc.protocol).toBe('imrobot')
    expect(doc.name).toBe('Handler Test')
    expect(doc.endpoints.challenge).toBe('/imrobot/challenge')
  })

  it('uses custom challengePath', () => {
    const handler = createDiscoveryHandler({ challengePath: '/auth/agent' })
    const req = { headers: {} }
    const res = createMockRes()

    handler(req, res)

    const doc = res.json.mock.calls[0][0] as DiscoveryDocument
    expect(doc.endpoints.challenge).toBe('/auth/agent/challenge')
    expect(doc.endpoints.verify).toBe('/auth/agent/verify')
  })

  it('sets default Cache-Control, CORS, Content-Type, and Vary headers', () => {
    const handler = createDiscoveryHandler()
    const req = { headers: {} }
    const res = createMockRes()

    handler(req, res)

    const headers = Object.fromEntries(res.setHeader.mock.calls)
    expect(headers['Content-Type']).toBe('application/json; charset=utf-8')
    expect(headers['Cache-Control']).toBe('public, max-age=3600')
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
    expect(headers['Vary']).toBe('Origin')
  })

  it('respects custom cacheControl and corsOrigin', () => {
    const handler = createDiscoveryHandler({
      cacheControl: 'no-store',
      corsOrigin: 'https://agents.example.com',
    })
    const req = { headers: {} }
    const res = createMockRes()

    handler(req, res)

    const headers = Object.fromEntries(res.setHeader.mock.calls)
    expect(headers['Cache-Control']).toBe('no-store')
    expect(headers['Access-Control-Allow-Origin']).toBe('https://agents.example.com')
  })

  it('omits Cache-Control when set to null', () => {
    const handler = createDiscoveryHandler({ cacheControl: null })
    const req = { headers: {} }
    const res = createMockRes()

    handler(req, res)

    const headers = Object.fromEntries(res.setHeader.mock.calls)
    expect(headers['Cache-Control']).toBeUndefined()
  })

  it('omits CORS headers when set to null', () => {
    const handler = createDiscoveryHandler({ corsOrigin: null })
    const req = { headers: {} }
    const res = createMockRes()

    handler(req, res)

    const headers = Object.fromEntries(res.setHeader.mock.calls)
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
    expect(headers['Vary']).toBeUndefined()
  })
})
