# imrobot threat model

imrobot is a reverse CAPTCHA: it checks that a caller can run code, not that the caller is a human. This page says plainly what that check proves and what it does not prove. Read it before you put imrobot in front of anything that matters.

## What imrobot proves

A valid answer proves that **something executed the challenge pipeline**, inside the time allowed, for a challenge your server issued and signed. Nothing more.

- **The challenge was ours and unchanged.** Every challenge is HMAC-SHA256 signed over its id, seed, pipeline, issue time, expiry, difficulty and answer hash (message format `v2`, 0.9). Changing any of them, including back-dating the issue time, gives `invalid_hmac`.
- **The answer is right.** The server re-runs the pipeline itself and compares it with the answer in constant time.
- **It was solved in time.** `expiresAt` is always enforced. With `minSolveMs` / `maxSolveMs` set, the solve time is checked against the server clock.
- **It was used once.** Only if you pass a `ChallengeReplayGuard` (single process) or a `RedisReplayStore` (several instances). Without one, the same solved challenge can be submitted again until it expires.
- **A signed agent is who it says it is** (Web Bot Auth, 0.9). A valid RFC 9421 signature proves the request was signed with a key published in that agent's key directory. It proves who signed, not that the signer is well behaved; your `accept` policy decides that.

## What imrobot does NOT prove

### A human with our open-source solver passes

The solver ships in the same package (`solveChallenge`, `npx imrobot solve`, `imrobot.solve_challenge`). A person who copies the challenge into it and pastes the answer back has "run code", and that is exactly what imrobot checks. **No reverse CAPTCHA can tell "a bot" from "a human driving a bot"**, and that includes ours, HATCHA, BOTCHA and Turingate. Their puzzles are open source too.

What raises the cost of doing it by hand:

| Control | Effect on a human with a script | Effect on a real agent |
|---|---|---|
| `maxSolveMs` (for example 5-8 s) | A manual copy, run and paste round trip often takes longer than this | None, agents answer in milliseconds |
| `sha256: true` | No shortcut by hand. SHA-256 needs code | None |
| Short `ttl` | Same as `maxSolveMs`, but coarser | None |
| Replay guard | One answer cannot be shared or reused | None |

None of these stops a human who **automates the round trip**, for example a browser extension or a ten-line script that fetches, solves and submits. Once that is automated, it is a bot, and imrobot is right to let it in.

### A fast answer is not proof of a bot, and a slow one is not proof of a human

`minSolveMs` rejects answers that arrive before your floor, for clients that are faster than any real agent you expect. That rarely matters; most deployments should leave it at `0`. `suspicious: true` (slower than the difficulty's threshold) is a hint for your logs, not a verdict.

### An LLM acting as a proxy for a human

A person can ask an LLM agent to solve the challenge for them. The agent solves it correctly, because it is an agent. If your goal is "only autonomous agents, never a person behind one", imrobot cannot enforce it. Pair it with Web Bot Auth so that you know **which** agent operator is calling, and hold that operator accountable through your `accept` policy and rate limits.

### Solver farms and scale

The challenges are cheap to solve on purpose, which is the point of a reverse CAPTCHA. So imrobot does not slow down volume. Use the built-in rate limiter and per-agent adaptive difficulty, and for signed agents, key your limits on the verified `keyid`.

### Secret compromise

Anyone holding your HMAC secret can mint challenges that verify. Keep it in a secret store, use at least 32 random bytes, and rotate it. After a rotation, challenges that are still in flight fail with `invalid_hmac` until they expire. The same happens on the upgrade to 0.9, because the HMAC message changed to `v2`.

### Web Bot Auth limits

- Replay inside the signature window: a signature that covers only `@authority` can be replayed to any path on your host until it is 5 minutes old (`maxAgeSeconds`) or its nonce has been seen. `requireComponents: ['@method', '@path']` binds it to one request, and `requireNonce: true` makes it single use. The default nonce store is in-process, so with several workers, pass a shared `nonceStore`.
- Without `authorities`, a signature made for another site can be replayed against yours with a spoofed `Host` header. Set `authorities` to your own hostnames. The adapters warn once when it is missing.
- `allowAnySignatureAgent` trusts any agent that can publish a key directory over public HTTPS. The SSRF guards refuse private, loopback, link-local and documentation addresses and numeric hostnames, but a hostname whose DNS later resolves to a private address is out of our reach. In production, pin `trustedSignatureAgents` or `directoryUrl`.

## What we check in code

- HMAC, verification hash and answer compares are constant time (`constantTimeEqual` in JS, `hmac.compare_digest` on UTF-8 bytes in Python).
- The JS and Python verifiers use the same message format. Challenges issued by one verify in the other, and a test pins a JS-issued challenge in the Python suite.
- The `sha256` operation is a real FIPS 180-4 SHA-256 in pure JS. It is tested against `node:crypto` and the published vectors.

## Reporting

Found a way past one of the checks above? Open a private security advisory on GitHub (`leopechnicki/im_robot`, Security tab) instead of a public issue.
