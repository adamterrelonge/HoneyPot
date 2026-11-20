from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.models import Share


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_share_round_trip(client: TestClient, save: dict[str, Any]) -> None:
    created = client.post("/api/shares", json=save)
    assert created.status_code == 201
    body = created.json()
    assert len(body["id"]) == 12
    assert body["url"].endswith(f"/api/shares/{body['id']}")

    fetched = client.get(f"/api/shares/{body['id']}")
    assert fetched.status_code == 200
    info = fetched.json()
    assert info["business_name"] == "Oakfield Academy"
    assert info["industry"] == "education"
    assert info["save"] == save


def test_share_ids_are_unique(client: TestClient, save: dict[str, Any]) -> None:
    ids = {client.post("/api/shares", json=save).json()["id"] for _ in range(20)}
    assert len(ids) == 20


def test_topology_saves_take_the_name_from_meta(client: TestClient, save: dict[str, Any]) -> None:
    save["business"] = {"kind": "topology", "topology": {"meta": {"name": "Hand-built Ltd"}}}
    share_id = client.post("/api/shares", json=save).json()["id"]
    info = client.get(f"/api/shares/{share_id}").json()
    assert info["business_name"] == "Hand-built Ltd"
    assert info["industry"] is None


def test_rejects_things_that_are_not_saves(client: TestClient, save: dict[str, Any]) -> None:
    assert client.post("/api/shares", json={**save, "format": "something-else"}).status_code == 422
    assert client.post("/api/shares", json={**save, "v": 2}).status_code == 422
    assert client.post("/api/shares", json={**save, "extra": True}).status_code == 422
    assert client.post("/api/shares", json={**save, "business": {"kind": "url"}}).status_code == 422


def test_rejects_oversized_saves(client: TestClient, save: dict[str, Any]) -> None:
    save["state"]["padding"] = "x" * 30_000  # over the 20 kB test limit
    assert client.post("/api/shares", json=save).status_code == 413


def test_unknown_and_expired_shares_are_404(client: TestClient, save: dict[str, Any]) -> None:
    assert client.get("/api/shares/doesnotexist").status_code == 404

    share_id = client.post("/api/shares", json=save).json()["id"]
    db = client.app.state.db  # type: ignore[attr-defined]
    with db.sessions() as s:
        share = s.get(Share, share_id)
        share.created_at = datetime.now(UTC) - timedelta(days=91)
        s.commit()
    assert client.get(f"/api/shares/{share_id}").status_code == 404


def test_purge_removes_only_expired_shares(client: TestClient, save: dict[str, Any]) -> None:
    from app.main import purge_expired_shares

    old = client.post("/api/shares", json=save).json()["id"]
    fresh = client.post("/api/shares", json=save).json()["id"]
    db = client.app.state.db  # type: ignore[attr-defined]
    with db.sessions() as s:
        s.get(Share, old).created_at = datetime.now(UTC) - timedelta(days=100)
        s.commit()
    assert purge_expired_shares(db, ttl_days=90) == 1
    assert client.get(f"/api/shares/{fresh}").status_code == 200


def test_cors_allows_the_dev_server(client: TestClient) -> None:
    r = client.options(
        "/api/shares",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    r = client.options(
        "/api/shares",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in r.headers
