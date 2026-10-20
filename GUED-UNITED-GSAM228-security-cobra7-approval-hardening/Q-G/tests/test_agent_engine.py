import pytest
from qg.agent_engine import AgentAction, AgentEngine, AgentProtocolError, ToolPolicy

def test_action_parser_accepts_only_protocol():
    assert AgentAction.parse('{"type":"final","answer":"ok"}').answer == "ok"
    with pytest.raises(AgentProtocolError):
        AgentAction.parse("run shell command")

def test_action_parser_rejects_non_object_tool_input():
    with pytest.raises(AgentProtocolError):
        AgentAction.parse('{"type":"tool","tool":"shell","input":"rm -rf /"}')

def test_catalog_exposes_enabled_handlers_only():
    async def noop(_):
        return {"ok": True}
    engine = AgentEngine(
        llm=None,
        policies={"read": ToolPolicy("read", enabled=True), "off": ToolPolicy("off", enabled=False)},
        handlers={"read": noop},
    )
    assert [x["name"] for x in engine.catalog()] == ["read"]

@pytest.mark.asyncio
async def test_approval_is_required_before_high_risk_tool():
    class FakeLLM:
        async def chat(self, *args, **kwargs):
            return {"choices":[{"message":{"content":'{"type":"tool","tool":"write","input":{"path":"x","content":"ok"}}'}}]}
    async def write(_):
        return {"written": True}
    engine = AgentEngine(
        FakeLLM(),
        {"write": ToolPolicy("write", enabled=True, risk="high", requires_approval=True)},
        {"write": write},
    )
    result = await engine.run("write x")
    assert result["status"] == "approval_required"
    assert result["tool"] == "write"

@pytest.mark.asyncio
async def test_low_risk_tool_result_returns_to_model():
    class FakeLLM:
        def __init__(self): self.calls = 0
        async def chat(self, messages, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return {"choices":[{"message":{"content":'{"type":"tool","tool":"read","input":{}}'}}]}
            assert any(m["role"] == "tool" for m in messages)
            return {"choices":[{"message":{"content":'{"type":"final","answer":"done"}'}}]}
    async def read(_):
        return {"value": "ok"}
    engine = AgentEngine(
        FakeLLM(),
        {"read": ToolPolicy("read", enabled=True)},
        {"read": read},
    )
    result = await engine.run("read")
    assert result["status"] == "completed"
    assert result["steps"] == 2


def test_action_parser_rejects_unknown_fields():
    with pytest.raises(AgentProtocolError):
        AgentAction.parse('{"type":"final","answer":"ok","execute":"shell"}')


@pytest.mark.asyncio
async def test_approval_rejected_if_capability_disabled_after_request():
    class FakeLLM:
        async def chat(self, *args, **kwargs):
            return {"choices":[{"message":{"content":'{"type":"tool","tool":"write","input":{"path":"x","content":"ok"}}'}}]}
    async def write(_):
        return {"written": True}
    policy = ToolPolicy("write", enabled=True, risk="high", requires_approval=True)
    engine = AgentEngine(FakeLLM(), {"write": policy}, {"write": write})
    result = await engine.run("write x")
    assert result["status"] == "approval_required"
    engine.policies["write"] = ToolPolicy("write", enabled=False, risk="high", requires_approval=True)
    with pytest.raises(ValueError, match="no longer enabled"):
        await engine.approve(result["approval_id"])


@pytest.mark.asyncio
async def test_approval_expires_and_cannot_be_replayed():
    class FakeLLM:
        async def chat(self, *args, **kwargs):
            return {"choices":[{"message":{"content":'{"type":"tool","tool":"write","input":{"path":"x","content":"ok"}}'}}]}
    async def write(_):
        return {"written": True}
    engine = AgentEngine(
        FakeLLM(),
        {"write": ToolPolicy("write", enabled=True, risk="high", requires_approval=True)},
        {"write": write},
    )
    result = await engine.run("write x")
    approval_id = result["approval_id"]
    engine.pending[approval_id]["expires_at"] = 0
    with pytest.raises(ValueError, match="Unknown or expired"):
        await engine.approve(approval_id)
    with pytest.raises(ValueError, match="Unknown or expired"):
        await engine.approve(approval_id)


@pytest.mark.asyncio
async def test_pending_approval_capacity_is_bounded():
    class FakeLLM:
        async def chat(self, *args, **kwargs):
            return {"choices":[{"message":{"content":'{"type":"tool","tool":"write","input":{"path":"x","content":"ok"}}'}}]}
    async def write(_):
        return {"written": True}
    engine = AgentEngine(
        FakeLLM(),
        {"write": ToolPolicy("write", enabled=True, risk="high", requires_approval=True)},
        {"write": write},
        max_pending_approvals=1,
    )
    first = await engine.run("first")
    second = await engine.run("second")
    assert first["status"] == "approval_required"
    assert second["status"] == "approval_capacity_exceeded"
    assert len(engine.pending) == 1
