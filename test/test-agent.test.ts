/**
 * Tests for the `imrobot test-agent <url>` probe.
 *
 * We mock global `fetch` (Node 20+ native) to simulate discovery documents,
 * challenge-attribute pages, script/meta references, and empty responses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  probeUrl,
  scanHtmlForSignals,
  formatProbeResult,
  verdictExitCode,
  cmdTestAgent,
} from '../src/cli/test-agent'

// ---------------------------------------------------------------------------
// Helpers to fake fetch()
// ---------------------------------------------------------------------------

interface FakeResponse {
  status: number
  headers?: Record<string, string>
  body: string
}

type Handler = (url: string) => FakeResponse | 'network-error'

function installFetchMock(handler: Handler) {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as URL).toString()
    const res = handler(url)
    if (res === 'network-error') {
      throw new Error('ECONNREFUSED')
    }
    const encoded = new TextEncoder().encode(res.body)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoded)
        controller.close()
      },
    })
    return new Response(stream, {
      status: res.status,
      headers: res.headers ?? { 'content-type': 'text/html; charset=utf-8' },
    })
  })
  return spy
}

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// scanHtmlForSignals — pure function, no fetch
// ---------------------------------------------------------------------------

describe('scanHtmlForSignals', () => {
  it('detects a data-imrobot-challenge attribute', () => {
    const html = '<html><body><div data-imrobot-challenge=\'{"id":"x"}\'></div></body></html>'
    const signals = scanHtmlForSignals(html)
    expect(signals.some((s) => s.kind === 'challenge_attribute')).toBe(true)
  })

  it('detects an imrobot script tag by src', () => {
    const html = '<html><head><script src="https://cdn.example.com/imrobot.min.js"></script></head></html>'
    const signals = scanHtmlForSignals(html)
    expect(signals.some((s) => s.kind === 'script_reference')).toBe(true)
  })

  it('detects a meta[name=imrobot] tag', () => {
    const html = '<html><head><meta name="imrobot" content="v1.0"></head></html>'
    const signals = scanHtmlForSignals(html)
    expect(signals.some((s) => s.kind === 'meta_tag')).toBe(true)
  })

  it('returns no signals on a plain page', () => {
    const html = '<html><body><h1>Hello</h1></body></html>'
    const signals = scanHtmlForSignals(html)
    expect(signals).toHaveLength(0)
  })

  it('is case-insensitive on attribute detection', () => {
    const html = '<div DATA-IMROBOT-CHALLENGE="{}"></div>'
    const signals = scanHtmlForSignals(html)
    expect(signals.some((s) => s.kind === 'challenge_attribute')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// probeUrl — full E2E with mocked fetch
// ---------------------------------------------------------------------------

describe('probeUrl', () => {
  it('returns YES when discovery document is served', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/.well-known/imrobot.json')) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            protocol: 'imrobot',
            version: '1.0',
            description: 'test svc',
            endpoints: {
              challenge: '/imrobot/challenge',
              verify: '/imrobot/verify',
              proofHeader: 'X-Agent-Proof',
            },
            difficulties: ['easy', 'medium', 'hard'],
            instructions: '',
          }),
        }
      }
      return { status: 200, body: '<html>irrelevant</html>' }
    })

    const result = await probeUrl('https://example.com')
    expect(result.verdict).toBe('yes')
    expect(result.discoveryDoc?.version).toBe('1.0')
    expect(result.signals[0].kind).toBe('discovery_document')
  })

  it('returns YES when page embeds challenge attribute (no discovery)', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/.well-known/imrobot.json')) {
        return { status: 404, body: 'not found' }
      }
      return {
        status: 200,
        body: '<html><body><div data-imrobot-challenge=\'{"id":"a"}\'></div></body></html>',
      }
    })

    const result = await probeUrl('https://example.com')
    expect(result.verdict).toBe('yes')
    expect(result.signals.some((s) => s.kind === 'challenge_attribute')).toBe(true)
  })

  it('returns LIKELY when only a script reference is found', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/.well-known/imrobot.json')) {
        return { status: 404, body: 'not found' }
      }
      return {
        status: 200,
        body: '<html><head><script src="/js/imrobot.js"></script></head><body></body></html>',
      }
    })

    const result = await probeUrl('https://example.com')
    expect(result.verdict).toBe('likely')
  })

  it('returns NO when no signals are present', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/.well-known/imrobot.json')) {
        return { status: 404, body: 'not found' }
      }
      return { status: 200, body: '<html><body><h1>Plain site</h1></body></html>' }
    })

    const result = await probeUrl('https://example.com')
    expect(result.verdict).toBe('no')
    expect(result.signals[0].kind).toBe('none')
  })

  it('returns ERROR when the URL is malformed', async () => {
    const result = await probeUrl('not a url')
    expect(result.verdict).toBe('error')
  })

  it('returns ERROR when fetch throws', async () => {
    installFetchMock((url) => {
      // discovery returns 404, then the html fetch throws
      if (url.endsWith('/.well-known/imrobot.json')) return { status: 404, body: '' }
      return 'network-error'
    })

    const result = await probeUrl('https://example.com')
    expect(result.verdict).toBe('error')
  })

  it('rejects non-http protocols', async () => {
    const result = await probeUrl('ftp://example.com')
    expect(result.verdict).toBe('error')
    expect(result.reason).toMatch(/http/i)
  })

  it('prepends https:// when protocol is missing', async () => {
    installFetchMock((url) => {
      expect(url.startsWith('https://')).toBe(true)
      if (url.endsWith('/.well-known/imrobot.json')) return { status: 404, body: '' }
      return { status: 200, body: '<html></html>' }
    })

    const result = await probeUrl('example.com')
    expect(result.verdict).toBe('no')
    expect(result.url).toContain('https://example.com')
  })

  it('ignores a discovery doc without protocol=imrobot', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/.well-known/imrobot.json')) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ protocol: 'something-else', version: '1' }),
        }
      }
      return { status: 200, body: '<html></html>' }
    })

    const result = await probeUrl('https://example.com')
    expect(result.verdict).toBe('no')
  })

  it('ignores discovery doc when content-type is not JSON', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/.well-known/imrobot.json')) {
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: '{"protocol":"imrobot","version":"1","endpoints":{}}',
        }
      }
      return { status: 200, body: '<html></html>' }
    })

    const result = await probeUrl('https://example.com')
    expect(result.verdict).toBe('no')
  })
})

// ---------------------------------------------------------------------------
// formatProbeResult / verdictExitCode / cmdTestAgent
// ---------------------------------------------------------------------------

describe('formatProbeResult', () => {
  it('includes discovery details when present', () => {
    const output = formatProbeResult({
      url: 'https://example.com/',
      verdict: 'yes',
      signals: [{ kind: 'discovery_document', source: 'x' }],
      reason: '.well-known found',
      discoveryDoc: {
        protocol: 'imrobot',
        version: '1.0',
        description: 't',
        endpoints: { challenge: '/c', verify: '/v', proofHeader: 'X-Agent-Proof' },
        difficulties: ['easy', 'medium', 'hard'],
        instructions: '',
      },
    })
    expect(output).toContain('YES')
    expect(output).toContain('protocol:')
    expect(output).toContain('imrobot')
  })

  it('shows the reason and signals for NO verdict', () => {
    const output = formatProbeResult({
      url: 'https://example.com/',
      verdict: 'no',
      signals: [{ kind: 'none', source: 'html' }],
      reason: 'nothing here',
      httpStatus: 200,
    })
    expect(output).toContain('NO')
    expect(output).toContain('nothing here')
    expect(output).toContain('200')
  })
})

describe('verdictExitCode', () => {
  it('returns 0 for yes and likely', () => {
    expect(verdictExitCode('yes')).toBe(0)
    expect(verdictExitCode('likely')).toBe(0)
  })
  it('returns 1 for no', () => {
    expect(verdictExitCode('no')).toBe(1)
  })
  it('returns 2 for error', () => {
    expect(verdictExitCode('error')).toBe(2)
  })
})

describe('cmdTestAgent', () => {
  it('returns exit 2 when url is missing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = await cmdTestAgent(undefined)
    expect(code).toBe(2)
    expect(errSpy).toHaveBeenCalled()
  })

  it('prints JSON when --json is passed', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/.well-known/imrobot.json')) return { status: 404, body: '' }
      return { status: 200, body: '<html></html>' }
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const code = await cmdTestAgent('https://example.com', { json: true })
    expect(code).toBe(1) // "no"
    // last console.log should be JSON
    const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(() => JSON.parse(printed)).not.toThrow()
  })
})
