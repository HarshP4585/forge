"""Anthropic + OpenAI streaming adapters with a shared interface.

Each provider exposes ``stream_turn`` which takes our internal
Anthropic-shaped history, the system prompt string, tool schemas in the
provider's native format, the model id, and an ``emit`` callback. Returns
a dict ``{"text": str, "tool_uses": [{"id", "name", "input"}]}`` so the
agent loop can build the next turn and decide whether to loop.
"""

import json
import uuid
from typing import Any, Awaitable, Callable, Dict, List

EmitFn = Callable[[Dict[str, Any]], Awaitable[None]]

CLAUDE_MAX_TOKENS = 4096


def _translate_to_openai(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Internal (Anthropic-shaped) history -> OpenAI chat completions format."""
    out: List[Dict[str, Any]] = []
    for m in messages:
        role = m["role"]
        content = m["content"]
        if role == "user":
            if isinstance(content, str):
                out.append({"role": "user", "content": content})
                continue
            user_parts: List[Dict[str, Any]] = []
            for block in content:
                t = block.get("type")
                if t == "text":
                    user_parts.append({"type": "text", "text": block["text"]})
                elif t == "image":
                    source = block.get("source") or {}
                    if source.get("type") == "base64":
                        data_url = (
                            f"data:{source.get('media_type', 'image/png')};"
                            f"base64,{source.get('data', '')}"
                        )
                        user_parts.append({
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        })
                elif t == "tool_result":
                    out.append({
                        "role": "tool",
                        "tool_call_id": block["tool_use_id"],
                        "content": str(block.get("content", "")),
                    })
            if user_parts:
                # Collapse to a string if it's just one text chunk — OpenAI
                # prefers a string when the content is text-only.
                if len(user_parts) == 1 and user_parts[0]["type"] == "text":
                    out.append({"role": "user", "content": user_parts[0]["text"]})
                else:
                    out.append({"role": "user", "content": user_parts})
        elif role == "assistant":
            if isinstance(content, str):
                out.append({"role": "assistant", "content": content})
                continue
            texts: List[str] = []
            tool_calls: List[Dict[str, Any]] = []
            for block in content:
                t = block.get("type")
                if t == "text":
                    texts.append(block["text"])
                elif t == "tool_use":
                    tool_calls.append({
                        "id": block["id"],
                        "type": "function",
                        "function": {
                            "name": block["name"],
                            "arguments": json.dumps(block["input"]),
                        },
                    })
                # thinking blocks are skipped — OpenAI has no equivalent
            msg: Dict[str, Any] = {
                "role": "assistant",
                "content": "\n".join(texts) if texts else None,
            }
            if tool_calls:
                msg["tool_calls"] = tool_calls
            out.append(msg)
    return out


class AnthropicProvider:
    kind = "claude"

    def __init__(self, api_key: str) -> None:
        from anthropic import AsyncAnthropic
        self._client = AsyncAnthropic(api_key=api_key)

    async def close(self) -> None:
        try:
            await self._client.close()
        except Exception:
            pass

    async def stream_turn(
        self,
        *,
        system: str,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        model: str,
        emit: EmitFn,
    ) -> Dict[str, Any]:
        msg_id = f"msg-{uuid.uuid4()}"
        streamed_text = ""

        async with self._client.messages.stream(
            model=model,
            max_tokens=CLAUDE_MAX_TOKENS,
            system=system,
            messages=messages,
            tools=tools,
        ) as stream:
            async for chunk in stream.text_stream:
                streamed_text += chunk
                await emit({
                    "type": "assistant.delta",
                    "text": chunk,
                    "message_id": msg_id,
                })
            final = await stream.get_final_message()

        final_text = ""
        tool_uses: List[Dict[str, Any]] = []
        for block in final.content:
            btype = getattr(block, "type", "")
            if btype == "text":
                final_text += getattr(block, "text", "") or ""
            elif btype == "tool_use":
                tool_uses.append({
                    "id": block.id,
                    "name": block.name,
                    "input": block.input or {},
                })

        if final_text:
            # If the stream never fired (rare), still surface the text.
            if not streamed_text:
                await emit({
                    "type": "assistant.delta",
                    "text": final_text,
                    "message_id": msg_id,
                })
            await emit({
                "type": "assistant.complete",
                "text": final_text,
                "message_id": msg_id,
            })

        usage = getattr(final, "usage", None)
        if usage is not None:
            i = int(getattr(usage, "input_tokens", 0) or 0)
            o = int(getattr(usage, "output_tokens", 0) or 0)
            if i or o:
                await emit({
                    "type": "usage",
                    "message_id": msg_id,
                    "input_tokens": i,
                    "output_tokens": o,
                })

        return {"text": final_text, "tool_uses": tool_uses}


class OpenAIProvider:
    kind = "openai"

    def __init__(self, api_key: str) -> None:
        from openai import AsyncOpenAI
        self._client = AsyncOpenAI(api_key=api_key)

    async def close(self) -> None:
        try:
            await self._client.close()
        except Exception:
            pass

    async def stream_turn(
        self,
        *,
        system: str,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        model: str,
        emit: EmitFn,
    ) -> Dict[str, Any]:
        msg_id = f"msg-{uuid.uuid4()}"
        openai_msgs: List[Dict[str, Any]] = [
            {"role": "system", "content": system}
        ]
        openai_msgs.extend(_translate_to_openai(messages))

        text = ""
        tool_calls: Dict[int, Dict[str, str]] = {}
        input_tokens = 0
        output_tokens = 0

        stream = await self._client.chat.completions.create(
            model=model,
            messages=openai_msgs,
            tools=tools,
            stream=True,
            stream_options={"include_usage": True},
        )

        async for chunk in stream:
            usage = getattr(chunk, "usage", None)
            if usage is not None:
                input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
                output_tokens = int(getattr(usage, "completion_tokens", 0) or 0)

            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta

            content = getattr(delta, "content", None)
            if content:
                text += content
                await emit({
                    "type": "assistant.delta",
                    "text": content,
                    "message_id": msg_id,
                })

            tc_deltas = getattr(delta, "tool_calls", None)
            if tc_deltas:
                for tc_delta in tc_deltas:
                    idx = tc_delta.index
                    tc = tool_calls.setdefault(
                        idx, {"id": "", "name": "", "arguments": ""}
                    )
                    if tc_delta.id:
                        tc["id"] = tc_delta.id
                    fn = getattr(tc_delta, "function", None)
                    if fn is not None:
                        if getattr(fn, "name", None):
                            tc["name"] = fn.name
                        if getattr(fn, "arguments", None):
                            tc["arguments"] += fn.arguments

        if text:
            await emit({
                "type": "assistant.complete",
                "text": text,
                "message_id": msg_id,
            })
        if input_tokens or output_tokens:
            await emit({
                "type": "usage",
                "message_id": msg_id,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            })

        tool_uses: List[Dict[str, Any]] = []
        for tc in tool_calls.values():
            try:
                args = json.loads(tc["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            tool_uses.append(
                {"id": tc["id"], "name": tc["name"], "input": args}
            )
        return {"text": text, "tool_uses": tool_uses}


def build_provider(agent_kind: str, api_key: str):
    if agent_kind == "claude":
        return AnthropicProvider(api_key)
    if agent_kind == "openai":
        return OpenAIProvider(api_key)
    raise ValueError(f"Unknown agent_kind: {agent_kind}")
