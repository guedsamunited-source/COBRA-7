from __future__ import annotations
import httpx
from .config import Settings
class ProviderError(RuntimeError): pass
class Provider:
    async def chat(self, messages, model, max_tokens, temperature): raise NotImplementedError
    async def health(self): raise NotImplementedError
class OllamaProvider(Provider):
    def __init__(self,cfg): self.cfg=cfg
    async def chat(self,messages,model,max_tokens,temperature):
        chosen=model or self.cfg.ollama_model
        if not chosen: raise ProviderError("No Ollama model configured")
        payload={"model":chosen,"messages":messages,"stream":False}; opts={}
        if max_tokens is not None: opts["num_predict"]=max_tokens
        if temperature is not None: opts["temperature"]=temperature
        if opts: payload["options"]=opts
        try:
            async with httpx.AsyncClient(timeout=self.cfg.request_timeout) as c: r=await c.post(f"{self.cfg.ollama_url}/api/chat",json=payload); r.raise_for_status(); data=r.json()
        except httpx.HTTPError as e: raise ProviderError(f"Ollama unavailable: {e.__class__.__name__}") from None
        try: return data["message"]["content"],chosen
        except (KeyError,TypeError): raise ProviderError("Invalid Ollama response") from None
    async def health(self):
        try:
            async with httpx.AsyncClient(timeout=5) as c: r=await c.get(f"{self.cfg.ollama_url}/api/tags"); r.raise_for_status(); models=[x.get("name","") for x in r.json().get("models",[])]
            ok=bool(self.cfg.ollama_model) and any(self.cfg.ollama_model==x or self.cfg.ollama_model==x.split(":")[0] for x in models); return {"ok":ok,"provider":"ollama","model":self.cfg.ollama_model}
        except (httpx.HTTPError,ValueError): return {"ok":False,"provider":"ollama","model":self.cfg.ollama_model}
class OpenAICompatProvider(Provider):
    def __init__(self,cfg): self.cfg=cfg
    async def chat(self,messages,model,max_tokens,temperature):
        chosen=model or self.cfg.openai_model
        if not self.cfg.openai_base_url or not chosen: raise ProviderError("OpenAI-compatible base URL/model not configured")
        payload={"model":chosen,"messages":messages,"stream":False}
        if max_tokens is not None: payload["max_tokens"]=max_tokens
        if temperature is not None: payload["temperature"]=temperature
        headers={"Authorization":f"Bearer {self.cfg.openai_api_key}"} if self.cfg.openai_api_key else {}
        try:
            async with httpx.AsyncClient(timeout=self.cfg.request_timeout) as c: r=await c.post(f"{self.cfg.openai_base_url}/chat/completions",json=payload,headers=headers); r.raise_for_status(); data=r.json()
        except httpx.HTTPError as e: raise ProviderError(f"LLM backend unavailable: {e.__class__.__name__}") from None
        try: return data["choices"][0]["message"]["content"] or "",chosen
        except (KeyError,IndexError,TypeError): raise ProviderError("Invalid OpenAI-compatible response") from None
def make_provider(cfg: Settings): return OllamaProvider(cfg) if cfg.provider=="ollama" else OpenAICompatProvider(cfg)
