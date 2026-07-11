"""
Invisible (zero-UI) verification for AI agents.

Port of src/core/invisible.ts -- agents verify themselves
programmatically without any UI interaction.
"""

from __future__ import annotations

import json
import time
import urllib.request
import urllib.error
from dataclasses import dataclass
from typing import Optional

from .core import solve_challenge
from .types import Challenge


@dataclass
class InvisibleVerifyResult:
    """Result of invisible verification."""

    success: bool
    proof_token: Optional[str] = None
    error: Optional[str] = None
    attempts: int = 0
    elapsed_ms: int = 0


def invisible_verify(
    challenge_url: str,
    verify_url: str,
    agent_id: str = "python-agent",
    max_retries: int = 3,
    timeout: int = 10,
) -> InvisibleVerifyResult:
    """
    Perform invisible (zero-UI) agent verification.

    Fetches a challenge from the server, solves it locally, and submits
    the answer for verification. Returns a proof token on success.

    Args:
        challenge_url: URL to GET a challenge (e.g., "https://api.example.com/imrobot/challenge").
        verify_url: URL to POST the answer (e.g., "https://api.example.com/imrobot/verify").
        agent_id: Identifier for this agent.
        max_retries: Maximum number of retry attempts.
        timeout: HTTP request timeout in seconds.

    Returns:
        InvisibleVerifyResult with success status and proof token.

    Example::

        result = invisible_verify(
            challenge_url="https://api.example.com/imrobot/challenge",
            verify_url="https://api.example.com/imrobot/verify",
            agent_id="my-bot-v1",
        )
        if result.success:
            headers = {"X-Agent-Proof": result.proof_token}
    """
    start = int(time.time() * 1000)

    for attempt in range(1, max_retries + 1):
        try:
            # 1. Fetch challenge
            req = urllib.request.Request(
                challenge_url,
                headers={"Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                challenge_data = json.loads(resp.read().decode("utf-8"))

            challenge = Challenge.from_dict(challenge_data)

            # 2. Solve
            answer = solve_challenge(challenge)

            # 3. Submit answer
            body = json.dumps({
                "challenge": challenge_data,
                "answer": answer,
                "agentId": agent_id,
            }).encode("utf-8")

            verify_req = urllib.request.Request(
                verify_url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                method="POST",
            )

            with urllib.request.urlopen(verify_req, timeout=timeout) as resp:
                result = json.loads(resp.read().decode("utf-8"))

            if result.get("valid"):
                elapsed = int(time.time() * 1000) - start
                return InvisibleVerifyResult(
                    success=True,
                    proof_token=result.get("proofToken"),
                    attempts=attempt,
                    elapsed_ms=elapsed,
                )

        except (urllib.error.URLError, json.JSONDecodeError, Exception) as e:
            if attempt == max_retries:
                elapsed = int(time.time() * 1000) - start
                return InvisibleVerifyResult(
                    success=False,
                    error=str(e),
                    attempts=attempt,
                    elapsed_ms=elapsed,
                )

    elapsed = int(time.time() * 1000) - start
    return InvisibleVerifyResult(
        success=False,
        error="Max retries exceeded",
        attempts=max_retries,
        elapsed_ms=elapsed,
    )
