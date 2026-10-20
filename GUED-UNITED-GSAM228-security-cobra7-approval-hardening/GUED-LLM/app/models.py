from typing import Literal
from pydantic import BaseModel, Field, field_validator

class Message(BaseModel):
    role: Literal["system","user","assistant","tool"]
    content: str = Field(min_length=1, max_length=100000)

class ChatRequest(BaseModel):
    model: str|None = Field(default=None, max_length=128)
    messages: list[Message] = Field(min_length=1, max_length=200)
    max_tokens: int|None = Field(default=None, ge=1, le=8192)
    temperature: float|None = Field(default=None, ge=0, le=2)
    stream: bool = False
    conversation_id: str|None = Field(default=None, max_length=96)
    remember: bool = True
    @field_validator("messages")
    @classmethod
    def validate_messages(cls, v):
        if not any(m.role == "user" for m in v): raise ValueError("At least one user message is required")
        return v

class AgentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$")

class AgentCreated(BaseModel):
    agent_id: str; name: str; token: str; warning: str
