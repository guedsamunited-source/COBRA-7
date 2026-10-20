from __future__ import annotations

import asyncio
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

ToolHandler = Callable[[dict[str, Any]], Awaitable[Any]]


class AgentProtocolError(ValueError):
    pass


@dataclass(frozen=True)
class ToolPolicy:
    name: str
    enabled: bool = False
    risk: str = "low"
    requires_approval: bool = False
    timeout_seconds: float = 15.0
    max_output_chars: int = 8000


@dataclass(frozen=True)
class AgentAction:
    kind: str
    answer: str = ""
    tool: str = ""
    input: dict[str, Any] | None = None

    @classmethod
    def parse(cls, content: str) -> "AgentAction":
        raw = content.strip()
        if raw.startswith("JSON:"):
            raw = raw[5:].strip()
        try:
            obj = json.loads(raw)
        except (json.JSONDecodeError, TypeError) as exc:
            raise AgentProtocolError("LLM did not return valid agent JSON") from exc
        if not isinstance(obj, dict):
            raise AgentProtocolError("Agent action must be a JSON object")
        kind = obj.get("type")
        if kind == "final":
            if set(obj) != {"type", "answer"}:
                raise AgentProtocolError("Final action contains missing or unknown fields")
            answer = obj.get("answer")
            if not isinstance(answer, str) or not answer.strip():
                raise AgentProtocolError("Final action requires a non-empty answer")
            return cls(kind="final", answer=answer[:12000])
        if kind == "tool":
            if set(obj) - {"type", "tool", "input"} or not {"type", "tool"} <= set(obj):
                raise AgentProtocolError("Tool action contains missing or unknown fields")
            tool = obj.get("tool")
            payload = obj.get("input", {})
            if not isinstance(tool, str) or not tool or len(tool) > 80:
                raise AgentProtocolError("Tool action requires a valid tool name")
            if not isinstance(payload, dict):
                raise AgentProtocolError("Tool input must be an object")
            return cls(kind="tool", tool=tool, input=payload)
        raise AgentProtocolError("Action type must be final or tool")


class AgentEngine:
    """Bounded tool-using loop. Model output is data, never executable code."""

    def __init__(
        self,
        llm: Any,
        policies: dict[str, ToolPolicy],
        handlers: dict[str, ToolHandler],
        max_steps: int = 8,
        approval_ttl_seconds: int = 300,
        max_pending_approvals: int = 100,
    ):
        self.llm = llm
        self.policies = policies
        self.handlers = handlers
        self.max_steps = max(1, min(max_steps, 20))
        self.approval_ttl_seconds = max(30, min(approval_ttl_seconds, 3600))
        self.max_pending_approvals = max(1, min(max_pending_approvals, 1000))
        self.pending: dict[str, dict[str, Any]] = {}

    def _prune_pending(self, now: float | None = None) -> None:
        current = time.time() if now is None else now
        expired = [
            approval_id for approval_id, item in self.pending.items()
            if item["expires_at"] <= current
        ]
        for approval_id in expired:
            self.pending.pop(approval_id, None)

    def catalog(self) -> list[dict[str, Any]]:
        return [
            {"name": p.name, "risk": p.risk, "requires_approval": p.requires_approval}
            for p in self.policies.values()
            if p.enabled and p.name in self.handlers
        ]

    def _system_prompt(self) -> str:
        catalog = json.dumps(self.catalog(), ensure_ascii=False)
        return (
            "You are COBRA-7, a bounded tool-using agent. "
            "Never claim an action happened unless the runtime returned its result. "
            "Never output code or arbitrary URLs for tool execution. "
            "Every response MUST be exactly one JSON object. "
            'For a tool call use {"type":"tool","tool":"NAME","input":{...}}. '
            'For completion use {"type":"final","answer":"..."} . '
            f"Only these tools are available: {catalog}"
        )

    async def run(self, task: str, conversation_id: str | None = None) -> dict[str, Any]:
        if not task or len(task) > 8000:
            raise ValueError("Task must contain 1-8000 characters")
        self._prune_pending()
        messages: list[dict[str, str]] = [
            {"role": "system", "content": self._system_prompt()},
            {"role": "user", "content": task},
        ]
        for step in range(1, self.max_steps + 1):
            result = await self.llm.chat(messages, conversation_id=conversation_id, remember=True)
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            action = AgentAction.parse(content)
            if action.kind == "final":
                return {"status": "completed", "steps": step, "answer": action.answer}
            policy = self.policies.get(action.tool)
            handler = self.handlers.get(action.tool)
            if not policy or not policy.enabled or not handler:
                raise AgentProtocolError(f"Tool not permitted: {action.tool}")
            if policy.requires_approval:
                self._prune_pending()
                if len(self.pending) >= self.max_pending_approvals:
                    return {"status": "approval_capacity_exceeded", "tool": action.tool}
                approval_id = secrets.token_urlsafe(32)
                now = time.time()
                self.pending[approval_id] = {
                    "tool": action.tool,
                    "input": action.input or {},
                    "conversation_id": conversation_id,
                    "task": task,
                    "created_at": now,
                    "expires_at": now + self.approval_ttl_seconds,
                }
                return {
                    "status": "approval_required",
                    "approval_id": approval_id,
                    "tool": action.tool,
                    "risk": policy.risk,
                    "expires_in_seconds": self.approval_ttl_seconds,
                }
            try:
                output = await asyncio.wait_for(handler(action.input or {}), timeout=policy.timeout_seconds)
            except asyncio.TimeoutError:
                output = {"error": "tool_timeout"}
            except Exception as exc:
                output = {"error": type(exc).__name__}
            serialized = json.dumps(output, ensure_ascii=False, default=str)
            messages.append({"role": "assistant", "content": content})
            messages.append({"role": "tool", "content": serialized[:policy.max_output_chars]})
        return {"status": "step_budget_exhausted", "steps": self.max_steps}

    async def approve(self, approval_id: str) -> dict[str, Any]:
        self._prune_pending()
        pending = self.pending.pop(approval_id, None)
        if not pending:
            raise ValueError("Unknown or expired approval")
        tool = pending["tool"]
        policy = self.policies.get(tool)
        handler = self.handlers.get(tool)
        if not policy or not policy.enabled or not policy.requires_approval or not handler:
            raise ValueError("Tool is no longer enabled or approvable")
        try:
            output = await asyncio.wait_for(
                handler(pending["input"]),
                timeout=policy.timeout_seconds,
            )
        except asyncio.TimeoutError:
            raise RuntimeError("Approved tool execution timed out") from None
        except Exception as exc:
            raise RuntimeError(f"Approved tool execution failed: {type(exc).__name__}") from None
        return {"status": "executed", "tool": tool, "result": output}
