"""LangChain and CrewAI adapters: real tool objects, real local site."""

from __future__ import annotations

import asyncio
import json

import pytest

from imrobot.gate import PASS_GATE_TOOL_NAME, SOLVE_TOOL_NAME

from ._site import Site


def test_langchain_tools(site: Site) -> None:
    pytest.importorskip("langchain_core")
    from imrobot.langchain import get_langchain_tools

    pass_tool, solve_tool = get_langchain_tools(agent_id="lc-agent", allow_private_hosts=True)
    assert (pass_tool.name, solve_tool.name) == (PASS_GATE_TOOL_NAME, SOLVE_TOOL_NAME)
    assert set(pass_tool.args) == {"url"}

    out = json.loads(pass_tool.invoke({"url": site.url}))
    assert isinstance(out["proofToken"], str)
    claims = asyncio.run(site.issuer.verify(out["proofToken"]))
    assert claims["valid"] is True and claims["payload"]["sub"] == "lc-agent"

    out = json.loads(asyncio.run(pass_tool.ainvoke({"url": site.url})))
    assert isinstance(out["proofToken"], str)

    challenge = asyncio.run(site.verifier.generate())
    answer = json.loads(solve_tool.invoke({"challenge": challenge}))["answer"]
    assert asyncio.run(site.verifier.verify(challenge, answer))["valid"] is True
    assert json.loads(solve_tool.invoke({"challenge": json.dumps(challenge)}))["answer"] == answer


def test_langchain_tools_refuse_private_hosts_by_default(site: Site) -> None:
    pytest.importorskip("langchain_core")
    from imrobot.langchain import get_langchain_tools

    pass_tool, _ = get_langchain_tools()
    assert json.loads(pass_tool.invoke({"url": site.url}))["error"] == "private_host"
    assert site.seen == []


def test_crewai_tools(site: Site) -> None:
    pytest.importorskip("crewai")
    from imrobot.crewai import ImRobotPassGateTool, get_crewai_tools

    pass_tool, solve_tool = get_crewai_tools(agent_id="crew-agent", allow_private_hosts=True)
    assert (pass_tool.name, solve_tool.name) == (PASS_GATE_TOOL_NAME, SOLVE_TOOL_NAME)

    out = json.loads(pass_tool.run(url=site.url))
    claims = asyncio.run(site.issuer.verify(out["proofToken"]))
    assert claims["valid"] is True and claims["payload"]["sub"] == "crew-agent"
    out = json.loads(asyncio.run(pass_tool.arun(url=site.url)))
    assert isinstance(out["proofToken"], str)

    challenge = asyncio.run(site.verifier.generate())
    answer = json.loads(solve_tool.run(challenge=challenge))["answer"]
    assert asyncio.run(site.verifier.verify(challenge, answer))["valid"] is True

    assert json.loads(ImRobotPassGateTool().run(url=site.url))["error"] == "private_host"
