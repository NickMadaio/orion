from __future__ import annotations

import json
from pathlib import Path

from .profile import HOME_LOCATION_NAME, HOME_TIMEZONE
from .memory import MemoryManager
from .cloud import AnthropicProvider, CloudRouter, configured_value
from .permissions import LOCAL_CAPABILITY_SUMMARY
from .provider import OllamaProvider
from .registry import RegisteredTool, ToolRegistry
from .store import Store
from .tools import TIME_TOOL, TOOLS


SYSTEM_PROMPT = f"""You are Orion, a local-first personal assistant. Use tools when they provide current facts.
{LOCAL_CAPABILITY_SUMMARY}
The runtime controller performs eligible local actions. Be concise, honest about limits, and never claim a tool result you have not received. If a request needs current time or date, use the time tool instead of estimating."""


def is_time_or_date_question(text: str) -> bool:
    lowered = text.lower()
    question_words = ("time", "date", "day is it", "today", "day of the week")
    return any(word in lowered for word in question_words)


def concise_time_answer(result: dict[str, str], request: str, location_name: str) -> str:
    from datetime import datetime

    now = datetime.fromisoformat(result["local_time"])
    lowered = request.lower()
    asks_for_date = any(word in lowered for word in ("date", "today", "day is it", "day of the week"))
    asks_for_time = "time" in lowered or not asks_for_date
    suffix = f" in {location_name}" if location_name.lower() in lowered else ""
    if asks_for_date and asks_for_time:
        return f"It’s {now.strftime('%A, %B')} {now.day}, {now.year}, {now.strftime('%I:%M %p').lstrip('0')}{suffix}."
    if asks_for_date:
        return f"Today is {now.strftime('%A, %B')} {now.day}, {now.year}{suffix}."
    return f"It’s currently {now.strftime('%I:%M %p').lstrip('0')}{suffix}."


class OrionRuntime:
    def __init__(self, data_path: Path, model: str = "gpt-oss:20b") -> None:
        data_path.parent.mkdir(parents=True, exist_ok=True)
        self.store = Store(data_path)
        self.memory = MemoryManager(self.store, data_path.parent.parent / "vault")
        self.provider = OllamaProvider(model=model)
        project_root = data_path.parent.parent
        cloud_model = configured_value("ORION_CLOUD_MODEL", project_root)
        cloud_enabled = configured_value("ORION_ENABLE_CLOUD_ESCALATION", project_root) == "true"
        api_key = configured_value("ANTHROPIC_API_KEY", project_root)
        self.router = CloudRouter(cloud_enabled, cloud_model)
        self.cloud = AnthropicProvider(api_key, cloud_model) if cloud_enabled and cloud_model and api_key else None
        self.registry = ToolRegistry()
        self.registry.register(RegisteredTool("get_current_time", TOOLS["get_current_time"], permission_level=0, timeout_seconds=5))

    def respond(self, user_text: str, conversation_id: int | None = None) -> tuple[int, str]:
        conversation_id = conversation_id or self.store.new_conversation()
        self.store.add_message(conversation_id, "user", user_text)
        if is_time_or_date_question(user_text):
            result = TOOLS["get_current_time"](timezone=HOME_TIMEZONE)
            self.store.audit_tool(conversation_id, "get_current_time", {"timezone": HOME_TIMEZONE}, result)
            answer = concise_time_answer(result, user_text, HOME_LOCATION_NAME)
            self.store.add_message(conversation_id, "assistant", answer)
            return conversation_id, answer
        relevant = self.memory.relevant(user_text)
        memory_context = ""
        if relevant:
            memory_context = "\nRelevant local memory:\n" + "\n".join(
                f"- [{item['category']}] {item['content']}" for item in relevant
            )
        messages = [{"role": "system", "content": SYSTEM_PROMPT + memory_context}, {"role": "user", "content": user_text}]
        decision = self.router.decide(user_text)
        if decision.requires_approval:
            answer = "The configured higher-cost cloud tier needs your approval before I use it."
            self.store.add_message(conversation_id, "assistant", answer)
            return conversation_id, answer
        if decision.use_cloud and self.cloud:
            result = self.cloud.chat(messages)
            answer = result["message"]["content"]
            self.store.audit_provider("anthropic", self.cloud.model, decision.reason, result.get("usage", {}))
            self.store.add_message(conversation_id, "assistant", answer)
            return conversation_id, answer
        try:
            first = self.provider.chat(messages, [TIME_TOOL])
        except RuntimeError:
            fallback = self.router.decide(user_text, local_failed=True)
            if fallback.use_cloud and self.cloud:
                result = self.cloud.chat(messages)
                answer = result["message"]["content"]
                self.store.audit_provider("anthropic", self.cloud.model, fallback.reason, result.get("usage", {}))
                self.store.add_message(conversation_id, "assistant", answer)
                return conversation_id, answer
            raise
        assistant = first["message"]
        tool_calls = assistant.get("tool_calls") or []
        if not tool_calls:
            answer = assistant.get("content", "I could not generate a response.")
            self.store.add_message(conversation_id, "assistant", answer)
            return conversation_id, answer

        messages.append(assistant)
        for call in tool_calls:
            function = call.get("function", {})
            name = function.get("name")
            arguments = function.get("arguments") or {}
            if name not in self.registry.names():
                result = {"error": f"Unknown tool: {name}"}
            else:
                result = self.registry.get(name).handler(**arguments)
            self.store.audit_tool(conversation_id, name or "unknown", arguments, result)
            messages.append({"role": "tool", "tool_name": name, "content": json.dumps(result)})

        final = self.provider.chat(messages, [TIME_TOOL])
        answer = final["message"].get("content", "I completed the tool request.")
        self.store.add_message(conversation_id, "assistant", answer)
        return conversation_id, answer
