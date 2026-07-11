/**
 * `imrobot test-agent <url>` — probe a URL to determine whether it accepts
 * AI agents via the imrobot reverse-CAPTCHA protocol.
 *
 * Detection strategy (highest confidence first):
 *   1. GET `<origin>/.well-known/imrobot.json` — if 200 & valid discovery doc, YES.
 *   2. Fetch <url>, scan HTML for either:
 *       - `data-imrobot-challenge` attribute in any tag → YES (embedded challenge)
 *       - `<script>` tag whose src or content references `imrobot` → LIKELY
 *       - `<meta name="imrobot" ...>` tag → LIKELY
 *   3. Otherwise NO.
 *
 * Exit codes:
 *   0 — accepts agents (YES / LIKELY)
 *   1 — does not accept / uncertain
 *   2 — network / usage error
 */

import type { DiscoveryDocument } from "../server/discovery";

export type Verdict = "yes" | "likely" | "no" | "error";

export interface ProbeResult {
  url: string;
  verdict: Verdict;
  signals: ProbeSignal[];
  discoveryDoc?: DiscoveryDocument;
  reason: string;
  httpStatus?: number;
}

export interface ProbeSignal {
  kind:
    | "discovery_document"
    | "challenge_attribute"
    | "script_reference"
    | "meta_tag"
    | "header"
    | "none";
  source: string;
  detail?: string;
}

const USER_AGENT =
  "imrobot-cli/test-agent (+https://github.com/leopechnicki/im_robot)";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 512_000; // 512 KB — enough to catch head + first content

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function normalizeUrl(input: string): URL {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) {
    raw = "https://" + raw;
  }
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are supported (got ${parsed.protocol})`);
  }
  return parsed;
}

async function fetchWithLimits(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; headers: Headers; text: string }> {
  const res = await withTimeout(
    fetch(url, {
      redirect: "follow",
      ...init,
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/json, text/html;q=0.9, */*;q=0.5",
        ...(init.headers as Record<string, string> | undefined),
      },
    }),
    REQUEST_TIMEOUT_MS,
    `fetch ${url}`,
  );

  // Bounded read — don't slurp multi-MB HTML.
  const reader = res.body?.getReader();
  let text = "";
  if (reader) {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let total = 0;
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return { status: res.status, headers: res.headers, text };
}

function isDiscoveryDocument(v: unknown): v is DiscoveryDocument {
  if (!v || typeof v !== "object") return false;
  const doc = v as Record<string, unknown>;
  return (
    doc.protocol === "imrobot" &&
    typeof doc.version === "string" &&
    typeof doc.endpoints === "object" &&
    doc.endpoints !== null
  );
}

/**
 * Try fetching `<origin>/.well-known/imrobot.json` at the URL's origin.
 * Returns the parsed doc when the endpoint returns a valid discovery document.
 */
export async function probeDiscoveryDocument(
  target: URL,
): Promise<DiscoveryDocument | null> {
  const wellKnown = new URL(
    "/.well-known/imrobot.json",
    target.origin,
  ).toString();
  try {
    const res = await fetchWithLimits(wellKnown);
    if (res.status !== 200) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("json")) return null;
    const parsed = JSON.parse(res.text) as unknown;
    return isDiscoveryDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Scan HTML for imrobot signals — challenge attribute, script/meta references.
 * Uses simple substring matching to avoid pulling in a DOM parser.
 */
export function scanHtmlForSignals(html: string): ProbeSignal[] {
  const signals: ProbeSignal[] = [];
  const lower = html.toLowerCase();

  if (lower.includes("data-imrobot-challenge")) {
    signals.push({
      kind: "challenge_attribute",
      source: "html",
      detail: "Found data-imrobot-challenge attribute in DOM",
    });
  }

  // Script tag referencing imrobot (loose match: src=... or inline import)
  const scriptRegex =
    /<script[^>]*(?:src=["'][^"']*imrobot[^"']*["']|imrobot)[^>]*>/i;
  const scriptMatch = html.match(scriptRegex);
  if (scriptMatch) {
    signals.push({
      kind: "script_reference",
      source: "html",
      detail: scriptMatch[0].slice(0, 200),
    });
  }

  const metaRegex = /<meta[^>]+name=["']imrobot[^"']*["'][^>]*>/i;
  const metaMatch = html.match(metaRegex);
  if (metaMatch) {
    signals.push({
      kind: "meta_tag",
      source: "html",
      detail: metaMatch[0].slice(0, 200),
    });
  }

  return signals;
}

/**
 * Full probe: check discovery doc first, then fall back to HTML scan.
 */
export async function probeUrl(rawUrl: string): Promise<ProbeResult> {
  let target: URL;
  try {
    target = normalizeUrl(rawUrl);
  } catch (err) {
    return {
      url: rawUrl,
      verdict: "error",
      signals: [],
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  // 1. Discovery doc (strongest signal)
  const doc = await probeDiscoveryDocument(target);
  if (doc) {
    return {
      url: target.toString(),
      verdict: "yes",
      signals: [
        {
          kind: "discovery_document",
          source: `${target.origin}/.well-known/imrobot.json`,
          detail: `Protocol ${doc.protocol}, version ${doc.version}, endpoints: challenge=${doc.endpoints?.challenge}, verify=${doc.endpoints?.verify}`,
        },
      ],
      discoveryDoc: doc,
      reason: `.well-known/imrobot.json declares imrobot support (v${doc.version})`,
    };
  }

  // 2. Fetch page HTML and scan
  let pageResult: { status: number; headers: Headers; text: string };
  try {
    pageResult = await fetchWithLimits(target.toString());
  } catch (err) {
    return {
      url: target.toString(),
      verdict: "error",
      signals: [],
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const headerSignals: ProbeSignal[] = [];
  const agentProof = pageResult.headers.get("x-agent-proof-required");
  if (agentProof) {
    headerSignals.push({
      kind: "header",
      source: "response headers",
      detail: `x-agent-proof-required: ${agentProof}`,
    });
  }

  const htmlSignals = scanHtmlForSignals(pageResult.text);
  const signals = [...headerSignals, ...htmlSignals];

  if (htmlSignals.some((s) => s.kind === "challenge_attribute")) {
    return {
      url: target.toString(),
      verdict: "yes",
      signals,
      reason: "Page embeds an imrobot challenge via data-imrobot-challenge",
      httpStatus: pageResult.status,
    };
  }

  if (
    htmlSignals.some(
      (s) => s.kind === "script_reference" || s.kind === "meta_tag",
    ) ||
    headerSignals.length > 0
  ) {
    return {
      url: target.toString(),
      verdict: "likely",
      signals,
      reason:
        "Page references imrobot via script/meta/header but no active challenge was found on the landing page",
      httpStatus: pageResult.status,
    };
  }

  return {
    url: target.toString(),
    verdict: "no",
    signals: [{ kind: "none", source: "html" }],
    reason:
      "No discovery doc, no challenge attribute, no imrobot script or meta detected",
    httpStatus: pageResult.status,
  };
}

// ---------------------------------------------------------------------------
// CLI adapter — pretty-prints a probe result.
// ---------------------------------------------------------------------------

function verdictBadge(v: Verdict): string {
  switch (v) {
    case "yes":
      return "✅ YES — accepts imrobot-verified agents";
    case "likely":
      return "🟡 LIKELY — imrobot references present, no active challenge";
    case "no":
      return "❌ NO — no imrobot markers detected";
    case "error":
      return "⚠️  ERROR — could not probe";
  }
}

export function formatProbeResult(result: ProbeResult): string {
  const lines: string[] = [];
  lines.push("\n🤖 imrobot test-agent\n");
  lines.push(`  Target:    ${result.url}`);
  if (result.httpStatus !== undefined) {
    lines.push(`  HTTP:      ${result.httpStatus}`);
  }
  lines.push(`  Verdict:   ${verdictBadge(result.verdict)}`);
  lines.push(`  Reason:    ${result.reason}`);
  lines.push("");
  if (result.signals.length > 0) {
    lines.push("  Signals:");
    for (const s of result.signals) {
      lines.push(`    - [${s.kind}] ${s.source}`);
      if (s.detail) lines.push(`        ${s.detail}`);
    }
  }
  if (result.discoveryDoc) {
    lines.push("");
    lines.push("  Discovery document:");
    lines.push(`    protocol:    ${result.discoveryDoc.protocol}`);
    lines.push(`    version:     ${result.discoveryDoc.version}`);
    lines.push(`    challenge:   ${result.discoveryDoc.endpoints?.challenge}`);
    lines.push(`    verify:      ${result.discoveryDoc.endpoints?.verify}`);
    lines.push(
      `    proofHeader: ${result.discoveryDoc.endpoints?.proofHeader}`,
    );
    if (result.discoveryDoc.difficulties) {
      lines.push(
        `    difficulties: ${result.discoveryDoc.difficulties.join(", ")}`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function verdictExitCode(v: Verdict): number {
  switch (v) {
    case "yes":
    case "likely":
      return 0;
    case "no":
      return 1;
    case "error":
      return 2;
  }
}

export async function cmdTestAgent(
  url: string | undefined,
  options: { json?: boolean } = {},
) {
  if (!url) {
    console.error("Error: test-agent requires a URL argument");
    console.error("Usage: npx imrobot test-agent <url>");
    return 2;
  }
  const result = await probeUrl(url);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatProbeResult(result));
  }
  return verdictExitCode(result.verdict);
}
