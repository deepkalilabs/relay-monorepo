from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from relay_backend.models.namespaces import CreateNamespaceRequest
from relay_backend.models.workflows import (
    SaveWorkflowRequest,
    Workflow,
    canonical_request_hash,
    to_workflow_summary,
)


def workflow_document() -> dict:
    return {
        "schemaVersion": "1.5",
        "id": "b4749f7e-4b22-43bf-8ef4-8ba5f79cb17b",
        "name": "  Checkout flow  ",
        "status": "draft",
        "revision": 1,
        "createdAt": "2026-07-30T12:00:00Z",
        "updatedAt": "2026-07-30T12:00:00Z",
        "source": {
            "provider": "browserbase",
            "sessionId": "sensitive-session",
            "startUrl": "https://shop.example",
        },
        "steps": [
            {
                "id": "fill-card",
                "order": 1,
                "name": "  Fill card number  ",
                "enabled": True,
                "page": {"id": "page-1", "url": "https://shop.example/checkout"},
                "target": {"selector": "#card"},
                "metadata": {
                    "recordedAt": "2026-07-30T12:00:01Z",
                    "origin": "recorded",
                    "sensitive": True,
                },
                "type": "fill",
                "payload": {"value": "4111111111111111"},
                "parameterBinding": {"source": "recorded"},
            },
            {
                "id": "open-shop",
                "order": 0,
                "name": "Open shop",
                "enabled": True,
                "page": {"id": "page-1", "url": "https://shop.example"},
                "metadata": {
                    "recordedAt": "2026-07-30T12:00:00Z",
                    "origin": "manual",
                    "sensitive": False,
                },
                "type": "navigate",
                "payload": {"url": "https://shop.example"},
            },
        ],
    }


def test_workflow_trims_canonical_names() -> None:
    workflow = Workflow.model_validate(workflow_document())

    assert workflow.name == "Checkout flow"
    assert workflow.steps[0].name == "Fill card number"


def test_workflow_rejects_unexpected_properties() -> None:
    document = workflow_document()
    document["secretExtra"] = "must not be accepted"

    with pytest.raises(ValidationError):
        Workflow.model_validate(document)


def test_workflow_keeps_schema_1_2_documents_readable() -> None:
    document = workflow_document()
    document["schemaVersion"] = "1.2"

    workflow = Workflow.model_validate(document)

    assert workflow.schema_version == "1.2"


def test_workflow_accepts_element_group_and_page_text_assertions() -> None:
    document = workflow_document()
    element_assertion = {
        "id": "assert-ready",
        "order": 0,
        "name": "Ready text exists",
        "enabled": True,
        "page": {"id": "page-1", "url": "https://shop.example"},
        "target": {
            "candidates": [{"kind": "role", "value": "status", "name": "Ready", "exact": True}]
        },
        "metadata": {
            "recordedAt": "2026-07-30T12:00:01Z",
            "origin": "manual",
            "sensitive": False,
        },
        "type": "assertion",
        "expectation": {"kind": "text_contains", "expected": "ready"},
    }
    group_assertion = {
        "id": "assert-profiles",
        "order": 1,
        "name": "Profiles exist",
        "enabled": True,
        "page": {"id": "page-1", "url": "https://shop.example"},
        "metadata": {
            "recordedAt": "2026-07-30T12:00:02Z",
            "origin": "manual",
            "sensitive": False,
        },
        "type": "assertion",
        "groupTarget": {
            "version": 1,
            "algorithm": "structural-token-v1",
            "root": {
                "tagName": "article",
                "role": "article",
                "sharedClasses": ["profile-card"],
            },
            "structureTokens": ["0:article:article", "1:header:"],
            "capturedMatchCount": 2,
        },
        "expectation": {"kind": "group_exists"},
    }
    page_text_assertion = {
        "id": "assert-page-text",
        "order": 2,
        "name": "John Snow exists",
        "enabled": True,
        "page": {"id": "page-1", "url": "https://shop.example", "title": "People"},
        "metadata": {
            "recordedAt": "2026-07-30T12:00:02Z",
            "origin": "manual",
            "sensitive": False,
        },
        "type": "assertion",
        "expectation": {"kind": "page_text_contains", "expected": "John Snow"},
    }
    document["steps"] = [element_assertion, group_assertion, page_text_assertion]

    workflow = Workflow.model_validate(document)

    assert [step.type for step in workflow.steps] == ["assertion", "assertion", "assertion"]
    _assert_matches_contract(workflow)


@pytest.mark.parametrize(
    "forbidden",
    [
        {"target": {"selector": "body"}},
        {"position": {"x": 0, "y": 0}},
        {"waitAfter": {"delayMs": 100}},
        {
            "groupTarget": {
                "version": 1,
                "algorithm": "structural-token-v1",
                "root": {"tagName": "article", "sharedClasses": []},
                "structureTokens": ["0:article:"],
                "capturedMatchCount": 2,
            }
        },
    ],
)
def test_page_text_assertion_rejects_target_position_and_wait_fields(forbidden: dict) -> None:
    document = workflow_document()
    document["steps"] = [
        {
            "id": "assert-page-text",
            "order": 0,
            "name": "John Snow exists",
            "enabled": True,
            "page": {"id": "page-1", "url": "https://shop.example"},
            "metadata": {
                "recordedAt": "2026-07-30T12:00:02Z",
                "origin": "manual",
                "sensitive": False,
            },
            "type": "assertion",
            "expectation": {"kind": "page_text_contains", "expected": "John Snow"},
            **forbidden,
        }
    ]

    with pytest.raises(ValidationError):
        Workflow.model_validate(document)


def test_page_text_assertion_requires_schema_1_5() -> None:
    document = workflow_document()
    document["steps"] = [
        {
            "id": "assert-page-text",
            "order": 0,
            "name": "John Snow exists",
            "enabled": True,
            "page": {"id": "page-1", "url": "https://shop.example"},
            "metadata": {
                "recordedAt": "2026-07-30T12:00:02Z",
                "origin": "manual",
                "sensitive": False,
            },
            "type": "assertion",
            "expectation": {"kind": "page_text_contains", "expected": "John Snow"},
        }
    ]

    for schema_version in ["1.2", "1.4"]:
        document["schemaVersion"] = schema_version
        with pytest.raises(ValidationError):
            Workflow.model_validate(document)


def test_workflow_rejects_mixed_assertion_targets_and_waits() -> None:
    document = workflow_document()
    document["steps"] = [
        {
            "id": "assert-profiles",
            "order": 0,
            "name": "Profiles exist",
            "enabled": True,
            "page": {"id": "page-1", "url": "https://shop.example"},
            "target": {"selector": ".profile"},
            "waitAfter": {"delayMs": 100},
            "metadata": {
                "recordedAt": "2026-07-30T12:00:02Z",
                "origin": "manual",
                "sensitive": False,
            },
            "type": "assertion",
            "groupTarget": {
                "version": 1,
                "algorithm": "structural-token-v1",
                "root": {"tagName": "article", "sharedClasses": []},
                "structureTokens": ["0:article:"],
                "capturedMatchCount": 2,
            },
            "expectation": {"kind": "group_exists"},
        }
    ]

    with pytest.raises(ValidationError):
        Workflow.model_validate(document)


@pytest.mark.parametrize(
    ("field", "coerced_value"),
    [
        ("enabled", "true"),
        ("order", "1"),
    ],
)
def test_workflow_rejects_coercive_primitive_values(
    field: str,
    coerced_value: str,
) -> None:
    document = workflow_document()
    document["steps"][0][field] = coerced_value

    with pytest.raises(ValidationError):
        Workflow.model_validate(document)


def test_element_steps_require_a_replayable_target() -> None:
    document = workflow_document()
    document["steps"][0]["target"] = {}

    with pytest.raises(ValidationError):
        Workflow.model_validate(document)


@pytest.mark.parametrize(
    ("step_type", "fields"),
    [
        ("click", {}),
        (
            "set_date",
            {"payload": {"value": "2026-07-30"}},
        ),
        (
            "select",
            {"payload": {"value": "us", "label": "United States"}},
        ),
        ("check", {}),
        ("uncheck", {}),
        (
            "keypress",
            {"payload": {"key": "Enter", "modifiers": ["Control"]}},
        ),
        ("submit", {}),
    ],
)
def test_all_element_step_variants_match_the_contract(
    step_type: str,
    fields: dict,
) -> None:
    document = workflow_document()
    step = deepcopy(document["steps"][0])
    step.pop("parameterBinding")
    step["type"] = step_type
    step.update(fields)
    if "payload" not in fields:
        step.pop("payload")
    document["steps"] = [step]

    workflow = Workflow.model_validate(document)

    assert workflow.steps[0].type == step_type
    _assert_matches_contract(workflow)


@pytest.mark.parametrize(
    "binding",
    [
        {"source": "recorded"},
        {"source": "fixed", "value": "secret"},
        {"source": "profile", "field": "identity.email"},
        {"source": "runtime"},
    ],
)
def test_all_parameter_bindings_match_the_contract(binding: dict) -> None:
    document = workflow_document()
    document["steps"] = [document["steps"][0]]
    document["steps"][0]["parameterBinding"] = binding

    workflow = Workflow.model_validate(document)

    _assert_matches_contract(workflow)


def test_summary_contains_only_safe_fields_and_sorts_steps() -> None:
    summary = to_workflow_summary(Workflow.model_validate(workflow_document()))
    dumped = summary.model_dump(mode="json", by_alias=True)

    assert dumped == {
        "id": "b4749f7e-4b22-43bf-8ef4-8ba5f79cb17b",
        "name": "Checkout flow",
        "status": "draft",
        "updatedAt": "2026-07-30T12:00:00Z",
        "steps": [
            {"id": "open-shop", "name": "Open shop", "order": 0},
            {"id": "fill-card", "name": "Fill card number", "order": 1},
        ],
    }
    assert "4111111111111111" not in repr(dumped)
    assert "sensitive-session" not in repr(dumped)


def test_canonical_request_hash_ignores_json_property_order() -> None:
    request = SaveWorkflowRequest.model_validate(
        {"workflow": workflow_document(), "expectedRevision": 1}
    )
    reordered = {
        "expectedRevision": 1,
        "workflow": deepcopy(workflow_document()),
    }

    assert canonical_request_hash("PUT", "/v1/workflows/abc", request) == (
        canonical_request_hash(
            "PUT",
            "/v1/workflows/abc",
            SaveWorkflowRequest.model_validate(reordered),
        )
    )
    assert canonical_request_hash("POST", "/v1/workflows/abc", request) != (
        canonical_request_hash("PUT", "/v1/workflows/abc", request)
    )


def test_validated_workflow_matches_authoritative_openapi_schema() -> None:
    workflow = Workflow.model_validate(workflow_document())

    _assert_matches_contract(workflow)
    assert workflow.id == UUID("b4749f7e-4b22-43bf-8ef4-8ba5f79cb17b")
    assert workflow.created_at == datetime(2026, 7, 30, 12, tzinfo=UTC)


def test_shared_conformance_fixtures_match_python_and_published_schemas() -> None:
    repository_root = Path(__file__).parents[3]
    fixtures = json.loads(
        (repository_root / "packages/workflow-contract/fixtures/conformance.json").read_text(
            encoding="utf-8"
        )
    )
    generated_schema = json.loads(
        (repository_root / "packages/workflow-contract/schema/workflow-1.5.schema.json").read_text(
            encoding="utf-8"
        )
    )
    generated_validator = Draft202012Validator(generated_schema, format_checker=FormatChecker())
    openapi_validators = [
        _workflow_validator(repository_root / "apps/relay-api/openapi.yaml"),
        _workflow_validator(
            repository_root / "apps/browser-recorder/docs/specs/cloud-workflow-api.openapi.yaml"
        ),
    ]

    for fixture in fixtures["cases"]:
        document = deepcopy(fixtures["baseDocument"])
        for mutation in fixture["mutations"]:
            target = document
            for segment in mutation["path"][:-1]:
                target = target[segment]
            target[mutation["path"][-1]] = mutation["value"]

        expected = fixture["expected"]
        pydantic_valid = True
        try:
            Workflow.model_validate(document)
        except ValidationError:
            pydantic_valid = False

        assert pydantic_valid is expected["persistence"], fixture["name"]
        assert (not list(generated_validator.iter_errors(document))) is expected["canonical"], (
            fixture["name"]
        )
        for validator in openapi_validators:
            assert (not list(validator.iter_errors(document))) is expected["persistence"], fixture[
                "name"
            ]


def test_namespace_name_is_trimmed_before_length_validation() -> None:
    assert CreateNamespaceRequest(name="  Acme  ").name == "Acme"

    with pytest.raises(ValidationError):
        CreateNamespaceRequest(name="   ")
    with pytest.raises(ValidationError):
        CreateNamespaceRequest(name=f"  {'a' * 101}  ")


def _assert_matches_contract(workflow: Workflow) -> None:
    with open("openapi.yaml", encoding="utf-8") as contract_file:
        contract = yaml.safe_load(contract_file)
    registry = Registry().with_resource(
        "urn:relay-openapi",
        Resource.from_contents(contract, default_specification=DRAFT202012),
    )
    validator = Draft202012Validator(
        {"$ref": "urn:relay-openapi#/components/schemas/Workflow"},
        registry=registry,
        format_checker=FormatChecker(),
    )

    errors = list(
        validator.iter_errors(workflow.model_dump(mode="json", by_alias=True, exclude_none=True))
    )

    assert errors == []

    shared_schema_path = (
        Path(__file__).parents[3]
        / "packages"
        / "workflow-contract"
        / "schema"
        / "workflow-1.5.schema.json"
    )
    shared_schema = json.loads(shared_schema_path.read_text(encoding="utf-8"))
    shared_errors = list(
        Draft202012Validator(shared_schema, format_checker=FormatChecker()).iter_errors(
            workflow.model_dump(mode="json", by_alias=True, exclude_none=True)
        )
    )

    assert shared_errors == []


def _workflow_validator(contract_path: Path) -> Draft202012Validator:
    contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
    resource_uri = contract_path.resolve().as_uri()
    registry = Registry().with_resource(
        resource_uri,
        Resource.from_contents(contract, default_specification=DRAFT202012),
    )
    return Draft202012Validator(
        {"$ref": f"{resource_uri}#/components/schemas/Workflow"},
        registry=registry,
        format_checker=FormatChecker(),
    )
