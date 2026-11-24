"""A small real imrobot site on 127.0.0.1 for the agent-client tests."""

from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional

from imrobot import ImRobotVerifier, ProofTokenIssuer

SECRET = "g" * 32


class Site:
    """A small imrobot site: challenge + verify + optional discovery document."""

    def __init__(self) -> None:
        self.verifier = ImRobotVerifier(SECRET, difficulty="easy")
        self.issuer = ProofTokenIssuer("t" * 32)
        self.discovery: Optional[Any] = None  # dict -> served at /.well-known/imrobot.json
        self.prefix = "/imrobot"
        self.overrides: dict[str, Callable[[BaseHTTPRequestHandler], None]] = {}
        self.seen: list[tuple[str, str, Any]] = []
        site = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_: Any) -> None:
                pass

            def _send(self, status: int, body: Any, headers: Optional[dict[str, str]] = None) -> None:
                data = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self) -> None:  # noqa: N802
                site.seen.append(("GET", self.path, None))
                if self.path in site.overrides:
                    return site.overrides[self.path](self)
                if self.path == "/.well-known/imrobot.json" and site.discovery is not None:
                    return self._send(200, site.discovery)
                if self.path.split("?")[0] == f"{site.prefix}/challenge":
                    return self._send(200, asyncio.run(site.verifier.generate()))
                return self._send(404, {"error": "not found"})

            def do_POST(self) -> None:  # noqa: N802
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                site.seen.append(("POST", self.path, body))
                if self.path in site.overrides:
                    return site.overrides[self.path](self)
                if self.path != f"{site.prefix}/verify":
                    return self._send(404, {"error": "not found"})
                result = asyncio.run(site.verifier.verify(body["challenge"], body["answer"]))
                if not result.get("valid"):
                    return self._send(400, result)
                token = asyncio.run(
                    site.issuer.issue(
                        agent_id=body.get("agentId", "anon"),
                        challenge_id=body["challenge"]["id"],
                        difficulty=body["challenge"]["difficulty"],
                        solve_time_ms=result["elapsed"],
                        suspicious=False,
                    )
                )
                return self._send(200, {**result, "proofToken": token})

        self.Handler = Handler
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
