"""Expose the curated model list per agent kind.

Edit MODELS to add/remove models. Frontend fetches this on demand to
populate the model picker in the New Session modal.

``GET /api/models/info`` resolves context-window + max-output for a
specific ``(kind, model)`` pair — hardcoded for Claude/OpenAI, live
from the vendor API for Gemini. See ``app.llm.model_info``.
"""

import asyncio
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Query, status

from app.llm.model_info import get_model_info
from app.schemas.credentials import AgentKind
from app.store import credentials as cred_store

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


@router.get("/details")
async def models_details() -> Dict[str, List[Dict[str, Any]]]:
    """Bulk version of ``/info`` — one call returns context info for
    every model across every provider. Gemini fetches happen in parallel
    so we don't serialize a dozen round-trips.

    Response shape:
      {
        "claude":  [ {id, context_window, max_output_tokens, source}, ... ],
        "openai":  [ ... ],
        "gemini":  [ ... ]
      }
    """
    async def _one(kind: str, model: str) -> Dict[str, Any]:
        api_key = cred_store.get_key(kind) or ""
        info = await get_model_info(kind, model, api_key)
        return {
            "id": model,
            "context_window": info.context_window if info else None,
            "max_output_tokens": info.max_output_tokens if info else None,
            "source": info.source if info else None,
        }

    tasks: Dict[str, List[asyncio.Task[Dict[str, Any]]]] = {}
    for kind, ids in MODELS.items():
        tasks[kind] = [asyncio.create_task(_one(kind, m)) for m in ids]

    out: Dict[str, List[Dict[str, Any]]] = {}
    for kind, task_list in tasks.items():
        out[kind] = await asyncio.gather(*task_list)
    return out


@router.get("/info")
async def model_info_endpoint(
    kind: AgentKind = Query(..., description="Provider (claude, openai, gemini)"),
    model: str = Query(..., description="Model id — must be in MODELS[kind]"),
) -> Dict[str, Any]:
    """Return context window + max output for a specific model.

    Response shape:
      {
        "kind": "gemini",
        "model": "gemini-2.5-pro",
        "context_window": 2000000,
        "max_output_tokens": 64000,
        "source": "api"      // or "static", or null if unknown
      }
    """
    if model not in MODELS.get(kind, []):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Unknown model '{model}' for provider '{kind}'.",
        )
    # For providers that require a key to live-fetch (Gemini), pass the
    # saved credential through. Static-table lookups don't need it but
    # it's harmless to pass an empty string.
    api_key = cred_store.get_key(kind) or ""
    info = await get_model_info(kind, model, api_key)
    if info is None:
        return {
            "kind": kind,
            "model": model,
            "context_window": None,
            "max_output_tokens": None,
            "source": None,
        }
    return {
        "kind": kind,
        "model": model,
        "context_window": info.context_window,
        "max_output_tokens": info.max_output_tokens,
        "source": info.source,
    }
