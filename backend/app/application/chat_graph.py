"""Stateless LangGraph orchestration for PDF-grounded chat."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict, cast

from langchain_core.runnables import RunnableLambda
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.application.chat import (
    CandidateValidationError,
    ValidatedPart,
    citations_to_parts,
    validate_candidate,
)
from app.application.contact import InterviewContactFormPart, classify_contact_intent
from app.domain.retrieval import SafetyOutcome, classify_safety
from app.infrastructure.chat_provider import ProviderFailure, ProviderResult
from app.infrastructure.pdf_rag import PdfCitation, PdfRetrievalError, PdfRetriever, PdfSearchResult

ModelInvoker = Callable[..., Awaitable[ProviderResult]]


class ChatGraphState(TypedDict, total=False):
    message: str
    invoke_model: ModelInvoker
    retriever: PdfRetriever
    safety: SafetyOutcome
    initial_completion: ProviderResult
    completion: ProviderResult
    portfolio_search_used: bool
    evidence: dict[str, object]
    citations: list[PdfCitation]
    fallback: bool
    refusal: str | None
    error: Exception | None
    parts: list[ValidatedPart]
    usage: dict[str, int]
    retrieval_results: list[PdfSearchResult]
    retrieval_query: str
    pending_text_deltas: list[str]
    on_text_delta: Callable[[str], None]
    on_portfolio_search: Callable[[], None]
    contact_intent: str | None
    contact_form_supported: bool


async def _invoke(state: ChatGraphState, *args: object) -> ProviderResult:
    async def call(_: object) -> ProviderResult:
        return await state["invoke_model"](*args)

    return await RunnableLambda[object, ProviderResult](call).ainvoke(None)


async def validate_safety(state: ChatGraphState) -> dict[str, object]:
    outcome = classify_safety(state["message"])
    return {
        "safety": outcome,
        "refusal": "unsafe" if outcome.classification == "unsafe" else None,
        "contact_intent": classify_contact_intent(state["message"]),
    }


def after_safety(state: ChatGraphState) -> str:
    return "finalize" if state.get("refusal") else "initial_answer"


async def initial_answer(state: ChatGraphState) -> dict[str, object]:
    try:
        completion = await _invoke(
            # Do not expose an initial answer before the graph knows whether it is
            # a general answer or must be grounded in the PDF.  A portfolio claim
            # without a tool call is correctly rejected later, but used to leak a
            # partial preview before that rejection.
            state,
            state["message"],
            None,
            None,
            0,
            0,
            None,
        )
    except (ProviderFailure, CandidateValidationError) as error:
        return {"error": error}
    return {"initial_completion": completion, "completion": completion}


def after_initial_answer(state: ChatGraphState) -> str:
    if state.get("error"):
        return "finalize"
    return "retrieve" if state["initial_completion"].tool_call is not None else "validate_output"


async def retrieve(state: ChatGraphState) -> dict[str, object]:
    callback = state.get("on_portfolio_search")
    if callback:
        callback()
    completion = state["initial_completion"]
    assert completion.tool_call is not None
    try:
        # search() performs blocking network (embeddings and pgvector I/O), so
        # offload it to a worker thread to avoid stalling the event loop.
        results = await asyncio.to_thread(state["retriever"].search, completion.tool_call.query)
    except PdfRetrievalError:
        results = []
    citations = [PdfCitation(item.chunk.filename, item.chunk.page) for item in results]
    evidence = {
        "chunks": [
            {"text": item.chunk.text, "filename": item.chunk.filename, "page": item.chunk.page}
            for item in results
        ]
    }
    return {
        "portfolio_search_used": True,
        "evidence": evidence,
        "citations": citations,
        "fallback": not results,
        "retrieval_results": results,
        "retrieval_query": completion.tool_call.query,
    }


def after_retrieval(state: ChatGraphState) -> str:
    return "fallback" if state.get("fallback") else "grounded_answer"


async def grounded_answer(state: ChatGraphState) -> dict[str, object]:
    initial = state["initial_completion"]
    buffered_deltas: list[str] = []

    def buffer_delta(delta: str) -> None:
        if delta:
            buffered_deltas.append(delta)

    try:
        completion = await _invoke(
            state,
            state["message"],
            state["evidence"],
            initial.tool_call,
            initial.total_input_tokens,
            initial.total_output_tokens,
            buffer_delta,
        )
        if completion.tool_call is not None:
            raise ProviderFailure("invalid-provider-output", retryable=False)
    except (ProviderFailure, CandidateValidationError) as error:
        if (
            isinstance(error, ProviderFailure)
            and error.diagnostic_metadata.get("incomplete_reason") == "max_output_tokens"
        ):
            # The grounded attempt was cut off by the aggregate output budget, so a
            # retry would run with an even smaller remaining budget and fail again.
            return {"error": error}
        if (
            not isinstance(error, ProviderFailure)
            or error.code != "invalid-provider-output"
            or error.total_input_tokens is None
            or error.total_output_tokens is None
        ):
            return {"error": error}
        # The completed Responses envelope was structurally rejected after it
        # reported usage. Retry this exact grounded request once, carrying that
        # usage forward so provider limits remain cumulative. Never replay the
        # rejected attempt's preview deltas.
        buffered_deltas = []
        try:
            completion = await _invoke(
                state,
                state["message"],
                state["evidence"],
                initial.tool_call,
                error.total_input_tokens,
                error.total_output_tokens,
                buffer_delta,
            )
            if completion.tool_call is not None:
                raise ProviderFailure("invalid-provider-output", retryable=False)
        except (ProviderFailure, CandidateValidationError) as retry_error:
            return {"error": retry_error}
    return {"completion": completion, "pending_text_deltas": buffered_deltas}


async def deterministic_fallback(state: ChatGraphState) -> dict[str, object]:
    initial = state["initial_completion"]
    return {
        "parts": [
            validate_candidate(
                {
                    "type": "text",
                    "text": "No encontré información del portfolio sobre ese tema.",
                    "grounding": "general",
                }
            )
        ],
        "usage": {"total_tokens": initial.total_tokens},
    }


async def validate_output(state: ChatGraphState) -> dict[str, object]:
    completion = state["completion"]
    parts: list[ValidatedPart] = []
    for candidate in completion:
        try:
            part = validate_candidate(candidate)
        except CandidateValidationError as error:
            return {"error": error}
        if part.grounding == "portfolio" and not state.get("citations"):
            return {
                "error": CandidateValidationError(
                    "invalid-provider-output", "No pude validar la respuesta."
                )
            }
        parts.append(part)
    if any(getattr(part, "grounding", None) == "portfolio" for part in parts):
        parts.extend(citations_to_parts(state.get("citations", [])))
    intent = state.get("contact_intent")
    if state.get("contact_form_supported") and intent in {
        "employment",
        "interview",
        "recruiting",
    }:
        parts.append(InterviewContactFormPart(intent=cast(Any, intent)))
    # A provider delta is only a preview. Emit it only after the final candidate
    # has passed the complete server-side contract, then let the following final
    # parts atomically replace that preview in the client.
    callback = state.get("on_text_delta")
    if callback:
        for delta in state.get("pending_text_deltas", []):
            callback(delta)
    return {"parts": parts, "usage": {"total_tokens": completion.total_tokens}}


def _graph() -> CompiledStateGraph[ChatGraphState, None, ChatGraphState, ChatGraphState]:
    graph: StateGraph[ChatGraphState, None, ChatGraphState, ChatGraphState] = StateGraph(
        ChatGraphState
    )
    for name, node in (
        ("validate_safety", validate_safety),
        ("initial_answer", initial_answer),
        ("retrieve", retrieve),
        ("grounded_answer", grounded_answer),
        ("fallback", deterministic_fallback),
        ("validate_output", validate_output),
    ):
        graph.add_node(name, node)
    graph.add_node("finalize", RunnableLambda[ChatGraphState, dict[str, object]](lambda _: {}))
    graph.add_edge(START, "validate_safety")
    graph.add_conditional_edges(
        "validate_safety",
        after_safety,
        {"initial_answer": "initial_answer", "finalize": "finalize"},
    )
    graph.add_conditional_edges(
        "initial_answer",
        after_initial_answer,
        {"retrieve": "retrieve", "validate_output": "validate_output", "finalize": "finalize"},
    )
    graph.add_conditional_edges(
        "retrieve", after_retrieval, {"grounded_answer": "grounded_answer", "fallback": "fallback"}
    )
    graph.add_edge("grounded_answer", "validate_output")
    graph.add_edge("fallback", "finalize")
    graph.add_edge("validate_output", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


async def run_chat_graph(state: ChatGraphState) -> ChatGraphState:
    result = await _graph().ainvoke(state)
    if not isinstance(result, dict):
        raise TypeError("compiled chat graph must return a state mapping")
    return cast(ChatGraphState, result)
