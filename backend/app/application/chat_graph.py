"""Small, stateless LangGraph orchestration for the grounded chat request."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import TypedDict, cast

from langchain_core.runnables import RunnableLambda
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.application.chat import CandidateValidationError, ProjectCardPart, SourcePart, TextPart
from app.domain.content import ContentBundle
from app.domain.retrieval import RetrievalOutcome
from app.infrastructure.chat_provider import ProviderFailure, ProviderResult

ValidatedPart = TextPart | SourcePart | ProjectCardPart
ModelInvoker = Callable[..., Awaitable[ProviderResult]]
Retriever = Callable[[str, ContentBundle], RetrievalOutcome]
ReferenceValidator = Callable[
    [Mapping[str, object], set[str], set[str], Mapping[str, set[str]]],
    Mapping[str, object],
]
EvidenceBuilder = Callable[
    [ContentBundle, RetrievalOutcome],
    tuple[dict[str, object], set[str], set[str], dict[str, set[str]]],
]
CandidateValidator = Callable[[Mapping[str, object], ContentBundle], ValidatedPart]


class ChatGraphState(TypedDict, total=False):
    message: str
    bundle: ContentBundle
    invoke_model: ModelInvoker
    retrieve_evidence: Retriever
    validate_references: ReferenceValidator
    build_evidence: EvidenceBuilder
    validate_candidate: CandidateValidator
    safety: RetrievalOutcome
    initial_completion: ProviderResult
    completion: ProviderResult
    portfolio_search_used: bool
    public_evidence: dict[str, object]
    record_ids: set[str]
    claim_ids: set[str]
    claims_by_record: dict[str, set[str]]
    fallback: bool
    refusal: str | None
    error: Exception | None
    parts: list[ValidatedPart]
    usage: dict[str, int]
    retrieval_outcome: RetrievalOutcome
    retrieval_query: str
    validation_category: str
    invalid_candidate: Mapping[str, object]
    on_text_delta: Callable[[str], None]
    on_portfolio_search: Callable[[], None]


async def _invoke(state: ChatGraphState, *args: object) -> ProviderResult:
    """Use a LangChain runnable for the provider integration at this graph boundary."""

    async def call(_: object) -> ProviderResult:
        return await state["invoke_model"](*args)

    return await RunnableLambda[object, ProviderResult](call).ainvoke(None)


async def validate_safety(state: ChatGraphState) -> dict[str, object]:
    outcome = state["retrieve_evidence"](state["message"], state["bundle"])
    return {
        "safety": outcome,
        "refusal": "unsafe" if outcome.classification == "unsafe" else None,
    }


def after_safety(state: ChatGraphState) -> str:
    return "finalize" if state.get("refusal") else "initial_answer"


async def initial_answer(state: ChatGraphState) -> dict[str, object]:
    try:
        completion = await _invoke(
            state, state["message"], None, None, 0, 0, state.get("on_text_delta")
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
    if callback is not None:
        callback()
    completion = state["initial_completion"]
    assert completion.tool_call is not None
    outcome = state["retrieve_evidence"](completion.tool_call.query, state["bundle"])
    if outcome.classification == "unsafe":
        return {
            "portfolio_search_used": True,
            "refusal": "unsafe",
            "usage": {"total_tokens": completion.total_tokens},
            "retrieval_outcome": outcome,
            "retrieval_query": completion.tool_call.query,
        }
    evidence, record_ids, claim_ids, claims_by_record = state["build_evidence"](
        state["bundle"],
        outcome,
    )
    return {
        "portfolio_search_used": True,
        "public_evidence": evidence,
        "record_ids": record_ids,
        "claim_ids": claim_ids,
        "claims_by_record": claims_by_record,
        "fallback": not bool(evidence["records"]),
        "retrieval_outcome": outcome,
        "retrieval_query": completion.tool_call.query,
    }


def after_retrieval(state: ChatGraphState) -> str:
    if state.get("refusal"):
        return "finalize"
    return "fallback" if state.get("fallback") else "grounded_answer"


async def grounded_answer(state: ChatGraphState) -> dict[str, object]:
    initial = state["initial_completion"]
    try:
        completion = await _invoke(
            state,
            state["message"],
            state["public_evidence"],
            initial.tool_call,
            initial.total_input_tokens,
            initial.total_output_tokens,
            state.get("on_text_delta"),
        )
        if completion.tool_call is not None:
            raise ProviderFailure("invalid-provider-output", retryable=False)
    except (ProviderFailure, CandidateValidationError) as error:
        return {"error": error}
    return {"completion": completion}


async def deterministic_fallback(state: ChatGraphState) -> dict[str, object]:
    initial = state["initial_completion"]
    part = state["validate_candidate"](
        {
            "type": "text",
            "text": "No encontré información del portfolio sobre ese tema.",
            "grounding": "general",
            "record_ids": [],
            "claim_ids": [],
        },
        state["bundle"],
    )
    return {"parts": [part], "usage": {"total_tokens": initial.total_tokens}}


async def validate_output(state: ChatGraphState) -> dict[str, object]:
    completion = state["completion"]
    parts: list[ValidatedPart] = []
    for candidate in completion:
        try:
            referenced = state["validate_references"](
                candidate,
                state.get("record_ids", set()),
                state.get("claim_ids", set()),
                state.get("claims_by_record", {}),
            )
        except CandidateValidationError as error:
            return {
                "error": error,
                "validation_category": "retrieval-reference",
                "invalid_candidate": candidate,
            }
        try:
            parts.append(state["validate_candidate"](referenced, state["bundle"]))
        except CandidateValidationError as error:
            return {
                "error": error,
                "validation_category": "candidate-contract",
                "invalid_candidate": candidate,
            }
    return {"parts": parts, "usage": {"total_tokens": completion.total_tokens}}


def finalize(_: ChatGraphState) -> dict[str, object]:
    return {}


def _graph() -> CompiledStateGraph[ChatGraphState, None, ChatGraphState, ChatGraphState]:
    graph: StateGraph[ChatGraphState, None, ChatGraphState, ChatGraphState] = StateGraph(
        ChatGraphState
    )
    graph.add_node("validate_safety", validate_safety)
    graph.add_node("initial_answer", initial_answer)
    graph.add_node("retrieve", retrieve)
    graph.add_node("grounded_answer", grounded_answer)
    graph.add_node("fallback", deterministic_fallback)
    graph.add_node("validate_output", validate_output)
    graph.add_node("finalize", RunnableLambda[ChatGraphState, dict[str, object]](finalize))
    graph.add_edge(START, "validate_safety")
    graph.add_conditional_edges(
        "validate_safety",
        after_safety,
        {"initial_answer": "initial_answer", "finalize": "finalize"},
    )
    graph.add_conditional_edges(
        "initial_answer",
        after_initial_answer,
        {
            "retrieve": "retrieve",
            "validate_output": "validate_output",
            "finalize": "finalize",
        },
    )
    graph.add_conditional_edges(
        "retrieve",
        after_retrieval,
        {
            "grounded_answer": "grounded_answer",
            "fallback": "fallback",
            "finalize": "finalize",
        },
    )
    graph.add_edge("grounded_answer", "validate_output")
    graph.add_edge("fallback", "finalize")
    graph.add_edge("validate_output", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


async def run_chat_graph(state: ChatGraphState) -> ChatGraphState:
    """Run one request without checkpoints or persistent graph state."""
    result = await _graph().ainvoke(state)
    if not isinstance(result, dict):
        raise TypeError("compiled chat graph must return a state mapping")
    return cast(ChatGraphState, result)
