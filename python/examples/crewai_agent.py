"""CrewAI crew that passes an imrobot gate.

    pip install "imrobot[crewai]"
    export ANTHROPIC_API_KEY=...
    npx tsx examples/demo-site.ts &        # optional local demo site (repo root)
    python examples/crewai_agent.py http://127.0.0.1:8787 --allow-private-hosts

``allow_private_hosts`` is off by default; turn it on only for a local demo site.
"""

import sys

from crewai import Agent, Crew, Task

from imrobot.crewai import get_crewai_tools

site = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787"

gatekeeper = Agent(
    role="Site access agent",
    goal="Get past reverse-CAPTCHA gates that ask AI agents to prove themselves",
    backstory="You are an AI agent. Sites protected by imrobot let you in once you solve their challenge.",
    tools=get_crewai_tools(
        agent_id="crewai-example",
        allow_private_hosts="--allow-private-hosts" in sys.argv,
    ),
    llm="anthropic/claude-opus-5-5",
)
task = Task(
    description=f"Pass the imrobot gate on {site}.",
    expected_output="The proof header name and the first 16 characters of the proof token.",
    agent=gatekeeper,
)
print(Crew(agents=[gatekeeper], tasks=[task]).kickoff())
