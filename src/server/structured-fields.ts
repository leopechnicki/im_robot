/**
 * Minimal RFC 8941 (Structured Field Values) parser: just what HTTP Message
 * Signatures (RFC 9421) and Web Bot Auth need. Dictionaries, inner lists,
 * parameters and the bare item types (string, token, integer, decimal, byte
 * sequence, boolean).
 *
 * Each dictionary member also keeps its exact source text (`raw`), because the
 * RFC 9421 `@signature-params` line must reproduce the signed serialization.
 *
 * Internal module: not part of the public API.
 */

export type BareItem =
  | { type: 'string'; value: string }
  | { type: 'token'; value: string }
  | { type: 'integer'; value: number }
  | { type: 'decimal'; value: number }
  | { type: 'binary'; value: string } // base64 text, undecoded
  | { type: 'boolean'; value: boolean }

export type Params = Map<string, BareItem>

export interface Item {
  kind: 'item'
  value: BareItem
  params: Params
}

export interface InnerList {
  kind: 'inner-list'
  items: Item[]
  params: Params
}

export type Member = (Item | InnerList) & { raw: string }

export class StructuredFieldError extends Error {}

class Parser {
  pos = 0
  constructor(readonly s: string) {}

  peek(): string {
    return this.s[this.pos] ?? ''
  }

  eof(): boolean {
    return this.pos >= this.s.length
  }

  skipSP(): void {
    while (this.peek() === ' ') this.pos++
  }

  skipOWS(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.pos++
  }

  fail(msg: string): never {
    throw new StructuredFieldError(`${msg} at offset ${this.pos}`)
  }

  key(): string {
    const c = this.peek()
    if (!/[a-z*]/.test(c)) this.fail('expected key')
    const start = this.pos
    while (/[a-z0-9_\-.*]/.test(this.peek()) && !this.eof()) this.pos++
    return this.s.slice(start, this.pos)
  }

  bareItem(): BareItem {
    const c = this.peek()
    if (c === '"') return this.string()
    if (c === ':') return this.binary()
    if (c === '?') return this.boolean()
    if (c === '-' || /[0-9]/.test(c)) return this.number()
    if (/[A-Za-z*]/.test(c)) return this.token()
    return this.fail('expected bare item')
  }

  string(): BareItem {
    this.pos++ // opening quote
    let out = ''
    for (;;) {
      if (this.eof()) this.fail('unterminated string')
      const c = this.s[this.pos++]
      if (c === '\\') {
        const n = this.s[this.pos++]
        if (n !== '"' && n !== '\\') this.fail('bad escape in string')
        out += n
      } else if (c === '"') {
        return { type: 'string', value: out }
      } else {
        const code = c.charCodeAt(0)
        if (code < 0x20 || code > 0x7e) this.fail('non-printable character in string')
        out += c
      }
    }
  }

  token(): BareItem {
    const start = this.pos
    this.pos++
    while (!this.eof() && /[!#$%&'*+\-.^_`|~0-9A-Za-z:/]/.test(this.peek())) this.pos++
    return { type: 'token', value: this.s.slice(start, this.pos) }
  }

  binary(): BareItem {
    this.pos++
    const end = this.s.indexOf(':', this.pos)
    if (end === -1) this.fail('unterminated byte sequence')
    const value = this.s.slice(this.pos, end)
    if (!/^[A-Za-z0-9+/=]*$/.test(value)) this.fail('bad byte sequence')
    this.pos = end + 1
    return { type: 'binary', value }
  }

  boolean(): BareItem {
    this.pos++
    const c = this.s[this.pos++]
    if (c === '1') return { type: 'boolean', value: true }
    if (c === '0') return { type: 'boolean', value: false }
    return this.fail('bad boolean')
  }

  number(): BareItem {
    const m = /^-?\d{1,15}(\.\d{1,3})?/.exec(this.s.slice(this.pos))
    if (!m) this.fail('bad number')
    this.pos += m[0].length
    if (m[1]) {
      // RFC 8941: at most 12 integer digits for a decimal.
      if (m[0].replace('-', '').split('.')[0].length > 12) this.fail('decimal too long')
      return { type: 'decimal', value: Number(m[0]) }
    }
    return { type: 'integer', value: Number(m[0]) }
  }

  params(): Params {
    const params: Params = new Map()
    while (this.peek() === ';') {
      this.pos++
      this.skipSP()
      const k = this.key()
      let v: BareItem = { type: 'boolean', value: true }
      if (this.peek() === '=') {
        this.pos++
        v = this.bareItem()
      }
      params.set(k, v)
    }
    return params
  }

  item(): Item {
    const value = this.bareItem()
    return { kind: 'item', value, params: this.params() }
  }

  innerList(): InnerList {
    this.pos++ // (
    const items: Item[] = []
    for (;;) {
      this.skipSP()
      if (this.peek() === ')') {
        this.pos++
        return { kind: 'inner-list', items, params: this.params() }
      }
      if (this.eof()) this.fail('unterminated inner list')
      items.push(this.item())
      const c = this.peek()
      if (c !== ' ' && c !== ')') this.fail('expected space or ) in inner list')
    }
  }

  itemOrInnerList(): Item | InnerList {
    return this.peek() === '(' ? this.innerList() : this.item()
  }
}

/** Parse a Dictionary field value. Later duplicate keys win (RFC 8941 4.2.2). */
export function parseDictionary(value: string): Map<string, Member> {
  const p = new Parser(value)
  const out = new Map<string, Member>()
  p.skipSP()
  if (p.eof()) return out
  for (;;) {
    const k = p.key()
    let member: Item | InnerList
    const start = p.pos
    if (p.peek() === '=') {
      p.pos++
      const valueStart = p.pos
      member = p.itemOrInnerList()
      out.set(k, { ...member, raw: value.slice(valueStart, p.pos) })
    } else {
      member = { kind: 'item', value: { type: 'boolean', value: true }, params: p.params() }
      out.set(k, { ...member, raw: value.slice(start, p.pos) })
    }
    p.skipOWS()
    if (p.eof()) return out
    if (p.peek() !== ',') p.fail('expected comma between members')
    p.pos++
    p.skipOWS()
    if (p.eof()) p.fail('trailing comma')
  }
}

/** Parse an Item field value (e.g. `"https://agent.example"`). */
export function parseItem(value: string): Item {
  const p = new Parser(value)
  p.skipSP()
  const item = p.item()
  p.skipSP()
  if (!p.eof()) p.fail('trailing characters after item')
  return item
}

/** Serialize a bare item (strings, tokens, integers, booleans, binary). */
export function serializeBareItem(item: BareItem): string {
  switch (item.type) {
    case 'string':
      return `"${item.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    case 'token':
      return item.value
    case 'integer':
      return String(item.value)
    case 'decimal': {
      const s = String(item.value)
      return s.includes('.') ? s : `${s}.0`
    }
    case 'binary':
      return `:${item.value}:`
    case 'boolean':
      return item.value ? '?1' : '?0'
  }
}

/** Serialize parameters (`;a=1;b="x"`), boolean true written as a bare key. */
export function serializeParams(params: Params): string {
  let out = ''
  for (const [k, v] of params) {
    out += v.type === 'boolean' && v.value ? `;${k}` : `;${k}=${serializeBareItem(v)}`
  }
  return out
}

/** Serialize an item or inner list with its parameters. */
export function serializeMember(member: Item | InnerList): string {
  if (member.kind === 'item')
    return serializeBareItem(member.value) + serializeParams(member.params)
  const inner = member.items.map((i) => serializeBareItem(i.value) + serializeParams(i.params))
  return `(${inner.join(' ')})${serializeParams(member.params)}`
}
