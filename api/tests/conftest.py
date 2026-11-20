from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client() -> Iterator[TestClient]:
    settings = Settings(database_url="sqlite:///:memory:", max_save_bytes=20_000, share_ttl_days=90)
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture
def save() -> dict[str, Any]:
    """A minimal save in the shape the browser produces (state contents are opaque to the API)."""
    return {
        "format": "honeypot-save",
        "v": 1,
        "business": {
            "kind": "spec",
            "spec": {
                "name": "Oakfield Academy",
                "industry": "education",
                "size": "sme",
                "employees": 24,
                "sites": 1,
                "hosting": "on-prem",
                "budget": "standard",
                "compliance": ["gdpr"],
                "seed": 1337,
            },
        },
        "seed": 1337,
        "hash": "a1b2c3d4",
        "state": {"v": 1, "tick": 120},
    }
