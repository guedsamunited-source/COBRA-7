import pytest

from qg.main import _limit_field, _strict_payload, _text_field


def test_tool_payload_rejects_unknown_and_missing_fields():
    with pytest.raises(ValueError, match="missing or unknown"):
        _strict_payload({"query": "ok", "url": "https://evil.example"}, {"query"})
    with pytest.raises(ValueError, match="missing or unknown"):
        _strict_payload({}, {"query"})


def test_text_field_rejects_non_string_and_oversized_values():
    with pytest.raises(ValueError, match="Invalid tool field"):
        _text_field({"query": ["not", "text"]}, "query", 1000)
    with pytest.raises(ValueError, match="Invalid tool field"):
        _text_field({"query": "x" * 1001}, "query", 1000)


@pytest.mark.parametrize("value", [True, False, 0, 11, "5", 3.5])
def test_tool_limit_rejects_invalid_types_and_ranges(value):
    with pytest.raises(ValueError, match="integer between 1 and 10"):
        _limit_field({"limit": value})


def test_tool_limit_accepts_bounded_integer():
    assert _limit_field({"limit": 10}) == 10


def test_approval_auth_fails_closed_when_separate_secret_is_missing(monkeypatch):
    from fastapi import HTTPException
    from qg import main

    monkeypatch.setattr(main, "APPROVAL_KEY", "")
    with pytest.raises(HTTPException) as error:
        main._approval_auth("the-general-agent-key")
    assert error.value.status_code == 503


def test_approval_auth_rejects_general_agent_key(monkeypatch):
    from fastapi import HTTPException
    from qg import main

    monkeypatch.setattr(main, "APPROVAL_KEY", "separate-approval-secret")
    with pytest.raises(HTTPException) as error:
        main._approval_auth("the-general-agent-key")
    assert error.value.status_code == 401
    main._approval_auth("separate-approval-secret")
