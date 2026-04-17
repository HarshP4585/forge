"""LLM integration layer.

- ``prompts``  — system prompt strings (copied verbatim from the project-root
  reference .md files) + runtime template renderer.
- ``context``  — assembles runtime template variables (cwd, platform, etc.).
- ``providers`` — Anthropic and OpenAI streaming clients with a shared
  ``stream_turn(system, messages, tools, model, emit)`` interface.
- ``agent``    — main-agent tool loop: build request, stream response,
  execute tools, loop until the model returns no more tool uses.
"""
