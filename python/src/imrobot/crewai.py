"""CrewAI tools for imrobot: let a CrewAI agent pass imrobot gates.

    >>> from imrobot.crewai import get_crewai_tools
    >>> agent = Agent(role="Researcher", goal="...", backstory="...",
    ...               tools=get_crewai_tools(agent_id="my-crew"))

Or configure one tool directly:

    >>> from imrobot.crewai import ImRobotPassGateTool
    >>> tool = ImRobotPassGateTool(agent_id="my-crew", timeout=5.0)

Both tools return a JSON string and never raise (an ``error`` field tells the
model what went wrong). Needs CrewAI: ``pip install "imrobot[crewai]"``.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional, Union

try:
    from crewai.tools import BaseTool
    from pydantic import BaseModel, Field
except ImportError as exc:  # pragma: no cover - exercised only without the extra
    raise ImportError('imrobot.crewai needs CrewAI: pip install "imrobot[crewai]"') from exc

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
    url: str = Field(..., description="Site URL, page URL or challenge endpoint (http or https).")


class SolveChallengeInput(BaseModel):
    challenge: Union[dict[str, Any], str] = Field(
        ..., description="The challenge object as received (JSON text is accepted too)."
    )


class ImRobotPassGateTool(BaseTool):  # type: ignore[misc]
    name: str = PASS_GATE_TOOL_NAME
    description: str = PASS_GATE_DESCRIPTION
    args_schema: type[BaseModel] = PassGateInput
    agent_id: Optional[str] = None
    timeout: float = DEFAULT_TIMEOUT
    #: Local development only: lets the tool call localhost / private addresses.
    allow_private_hosts: bool = False
    user_agent: Optional[str] = None

    def _run(self, url: str, **_: Any) -> str:
        return pass_gate_tool(
            url,
            agent_id=self.agent_id,
            timeout=self.timeout,
            allow_private_hosts=self.allow_private_hosts,
            user_agent=self.user_agent,
        )

    async def _arun(self, url: str, **_: Any) -> str:
        return await asyncio.to_thread(self._run, url)


class ImRobotSolveChallengeTool(BaseTool):  # type: ignore[misc]
    name: str = SOLVE_TOOL_NAME
    description: str = SOLVE_DESCRIPTION
    args_schema: type[BaseModel] = SolveChallengeInput

    def _run(self, challenge: Union[dict[str, Any], str], **_: Any) -> str:
        return solve_challenge_tool(challenge)

    async def _arun(self, challenge: Union[dict[str, Any], str], **_: Any) -> str:
        return self._run(challenge)


def get_crewai_tools(
    *,
    agent_id: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    allow_private_hosts: bool = False,
    user_agent: Optional[str] = None,
) -> list[BaseTool]:
    """Both imrobot tools, configured. ``allow_private_hosts`` is for local development."""
    return [
        ImRobotPassGateTool(
            agent_id=agent_id,
            timeout=timeout,
            allow_private_hosts=allow_private_hosts,
            user_agent=user_agent,
        ),
        ImRobotSolveChallengeTool(),
    ]


__all__ = [
    "ImRobotPassGateTool",
    "ImRobotSolveChallengeTool",
    "PassGateInput",
    "SolveChallengeInput",
    "get_crewai_tools",
]
