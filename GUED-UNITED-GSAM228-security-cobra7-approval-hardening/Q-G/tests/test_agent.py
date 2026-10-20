import pytest
from qg.planner import SafePlanner
from qg.memory import AgentMemory
from qg.tools import ToolRegistry, ToolPermission


def test_planner_bounds_objective():
    with pytest.raises(ValueError):
        SafePlanner().create("")


def test_memory_is_bounded():
    memory = AgentMemory()
    for i in range(150):
        memory.put(str(i), "x")
    assert len(memory._items) == 100


def test_tools_are_disabled_by_default():
    registry = ToolRegistry()
    assert registry.names() == []
    assert not registry.allowed("shell")
