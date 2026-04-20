"""Expose the curated model list per agent kind.

Edit MODELS to add/remove models. Frontend fetches this on demand to
populate the model picker in the New Session modal.
"""

from typing import Dict, List

from fastapi import APIRouter

router = APIRouter(prefix="/api/models", tags=["models"])

MODELS: Dict[str, List[str]] = {
    # All Claude 4.x models share the same Messages API shape.
    "claude": [
        "claude-opus-4-7",
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
    ],
    # Latest OpenAI models that work with the standard Chat Completions
    # request shape (streaming + system role + tools). o-series reasoning
    # models intentionally excluded — they'd need per-model branching.
    "openai": [
        "gpt-5",
        "gpt-4.1",
        "gpt-5-mini",
    ],
    # Google Gemini text models. 2.5 family is stable; 3.x is preview-only.
    # Image-gen, TTS, native-audio, and live variants excluded — they need
    # a different request shape.
    "gemini": [
        "gemini-3.1-pro-preview",
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite-preview",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
    ],
}


@router.get("")
async def list_models() -> Dict[str, List[str]]:
    return MODELS
