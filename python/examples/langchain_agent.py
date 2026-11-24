"""LangChain agent that passes an imrobot gate.

    pip install "imrobot[langchain]" langchain "langchain[anthropic]"
    export ANTHROPIC_API_KEY=...
    npx tsx examples/demo-site.ts &        # optional local demo site (repo root)
    python examples/langchain_agent.py http://127.0.0.1:8787 --allow-private-hosts

The two imrobot tools return JSON strings. ``allow_private_hosts`` is off by
default (a model can be talked into calling internal URLs); turn it on only for
a local demo site.
"""

import sys

from langchain.agents import create_agent

from imrobot.langchain import get_langchain_tools

site = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787"
tools = get_langchain_tools(
    agent_id="langchain-example",
    allow_private_hosts="--allow-private-hosts" in sys.argv,
)

agent = create_agent(
    model="anthropic:claude-opus-5-5",
    tools=tools,
    system_prompt="You are an AI agent. When a site asks you to prove you are an agent, use the imrobot tools.",
)
result = agent.invoke(
    {
        "messages": [
            {
                "role": "user",
                "content": f"Pass the imrobot gate on {site} and tell me which header to send "
                "(show only the first 16 characters of the token).",
            }
        ]
    }
)
print(result["messages"][-1].content)
