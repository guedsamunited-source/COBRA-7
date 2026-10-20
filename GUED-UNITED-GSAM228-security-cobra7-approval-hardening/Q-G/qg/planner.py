from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Plan:
    objective: str
    steps: tuple[str, ...]


class SafePlanner:
    """Deterministic planner scaffold. It does not execute actions."""

    def create(self, objective: str) -> Plan:
        objective = objective.strip()
        if not objective or len(objective) > 4000:
            raise ValueError("Invalid objective")
        return Plan(objective=objective, steps=("understand", "answer"))
