from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from .client import GUEDLLMClient

Tool = Callable[[dict[str, Any]], Awaitable[Any]]


@dataclass
class ToolSpec:
    name: str
    description: str
    handler: Tool


@dataclass
class AgentPolicy:
    max_steps: int = 6
    allowed_tools: set[str] = field(default_factory=set)
    max_tool_output_chars: int = 8000


class Cobra7Agent:
    """Bounded agent runtime. No tool is executable unless explicitly allowlisted."""

    def __init__(self, llm: GUEDLLMClient, policy: AgentPolicy | None = None):
        self.llm = llm
        self.policy = policy or AgentPolicy()
        self.tools: dict[str, ToolSpec] = {}

    def register_tool(self, spec: ToolSpec) -> None:
        self.tools[spec.name] = spec

    def tool_catalog(self) -> list[dict[str, str]]:
        return [
            {"name": t.name, "description": t.description}
            for t in self.tools.values()
            if t.name in self.policy.allowed_tools
        ]

    async def run(self, task: str, conversation_id: str | None = None) -> dict[str, Any]:
        messages: list[dict[str, str]] = [
            {"role": "system", "content": "You are COBRA-7. Never claim to have executed a tool unless execution is returned by the runtime."},
            {"role": "user", "content": task},
        ]
        for step in range(self.policy.max_steps):
            result = await self.llm.chat(messages, conversation_id=conversation_id, remember=True)
            choice = result.get("choices", [{}])[0]
            message = choice.get("message", {})
            content = message.get("content", "")
            # Tool invocation is deliberately not inferred from arbitrary model text.
            # A future structured tool-call adapter can validate a signed/typed action here.
            return {"agent": "COBRA-7", "step": step + 1, "content": content, "raw": result}
        raise RuntimeError("COBRA-7 step budget exhausted")
