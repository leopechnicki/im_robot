"""LangChain tools for imrobot: let a LangChain / LangGraph agent pass imrobot gates.

    >>> from imrobot.langchain import get_langchain_tools
    >>> tools = get_langchain_tools(agent_id="my-agent")
    >>> agent = create_agent(model, tools=tools)   # any LangChain agent

Two tools, both return a JSON string and never raise (an ``error`` field tells
the model what went wrong):

- ``imrobot_pass_gate(url)``: find the site's challenge, solve it, return
  ``{"proofToken", "proofHeader", ...}``.
- ``imrobot_solve_challenge(challenge)``: solve a challenge the agent already has.

Needs ``langchain-core``: ``pip install "imrobot[langchain]"``.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional, Union

try:
    from langchain_core.tools import BaseTool, StructuredTool
    from pydantic import BaseModel, Field
except ImportError as exc:  # pragma: no cover - exercised only without the extra
    raise ImportError(
        'imrobot.langchain needs langchain-core: pip install "imrobot[langchain]"'
    ) from exc

from .gate import (
    DEFAULT_TIMEOUT,
    PASS_GATE_DESCRIPTION,
    PASS_GATE_TOOL_NAME,
    SOLVE_DESCRIPTION,
    SOLVE_TOOL_NAME,
    pass_gate_tool,
    solve_challenge_tool,
)


class PassGateInput(BaseModel):
    url: str = Field(description="Site URL, page URL or challenge endpoint (http or https).")


class SolveChallengeInput(BaseModel):
    challenge: Union[dict[str, Any], str] = Field(
        description="The challenge object as received (JSON text is accepted too)."
    )


def get_langchain_tools(
    *,
    agent_id: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    allow_private_hosts: bool = False,
    user_agent: Optional[str] = None,
) -> list[BaseTool]:
    """The two imrobot tools as LangChain ``StructuredTool`` objects.

    The options go to :func:`imrobot.gate.pass_gate`; ``allow_private_hosts``
    is for local development only.
    """

    def _pass(url: str) -> str:
        return pass_gate_tool(
            url,
            agent_id=agent_id,
            timeout=timeout,
            allow_private_hosts=allow_private_hosts,
            user_agent=user_agent,
        )

    async def _apass(url: str) -> str:
        return await asyncio.to_thread(_pass, url)

    def _solve(challenge: Union[dict[str, Any], str]) -> str:
        return solve_challenge_tool(challenge)

    async def _asolve(challenge: Union[dict[str, Any], str]) -> str:
        return _solve(challenge)

    return [
        StructuredTool.from_function(
            func=_pass,
            coroutine=_apass,
            name=PASS_GATE_TOOL_NAME,
            description=PASS_GATE_DESCRIPTION,
            args_schema=PassGateInput,
        ),
        StructuredTool.from_function(
            func=_solve,
            coroutine=_asolve,
            name=SOLVE_TOOL_NAME,
            description=SOLVE_DESCRIPTION,
            args_schema=SolveChallengeInput,
        ),
    ]


__all__ = ["PassGateInput", "SolveChallengeInput", "get_langchain_tools"]
