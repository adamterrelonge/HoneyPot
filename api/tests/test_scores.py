from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.schemas import grade_for


def run(**overrides: Any) -> dict[str, Any]:
    return {
        "scenario_id": "monday-ransomware",
        "player": "Ada",
        "industry": "professional",
        "score": 720,
        "seed": 42,
        "state_hash": "deadbeef",
        **overrides,
    }


@pytest.mark.parametrize(
    ("score", "grade"),
    [(1000, "A"), (850, "A"), (849, "B"), (700, "B"), (550, "C"), (400, "D"), (399, "F"), (0, "F")],
)
def test_grades_match_the_engine_thresholds(score: int, grade: str) -> None:
    assert grade_for(score) == grade


def test_submit_returns_grade_and_rank(client: TestClient) -> None:
    first = client.post("/api/scores", json=run(score=600))
    assert first.status_code == 201
    assert first.json()["grade"] == "C"
    assert first.json()["rank"] == 1

    better = client.post("/api/scores", json=run(player="Grace", score=900)).json()
    assert (better["grade"], better["rank"]) == ("A", 1)
    worse = client.post("/api/scores", json=run(player="Linus", score=100)).json()
    assert (worse["grade"], worse["rank"]) == ("F", 3)


def test_leaderboard_is_per_scenario_and_ordered(client: TestClient) -> None:
    for player, score in [("Ada", 700), ("Grace", 910), ("Alan", 820)]:
        client.post("/api/scores", json=run(player=player, score=score))
    client.post("/api/scores", json=run(scenario_id="black-friday", player="Other", score=999))

    board = client.get("/api/scenarios/monday-ransomware/leaderboard").json()
    assert [(r["rank"], r["player"], r["score"], r["grade"]) for r in board] == [
        (1, "Grace", 910, "A"),
        (2, "Alan", 820, "B"),
        (3, "Ada", 700, "B"),
    ]
    assert len(client.get("/api/scenarios/monday-ransomware/leaderboard?limit=2").json()) == 2


def test_server_computes_the_grade(client: TestClient) -> None:
    # A client can't claim a grade: unknown fields are rejected, and the grade comes from the score.
    assert client.post("/api/scores", json=run(grade="A")).status_code == 422


@pytest.mark.parametrize(
    "bad",
    [
        {"score": 1001},
        {"score": -1},
        {"player": ""},
        {"player": "   "},
        {"player": "x" * 25},
        {"player": "bell\x07"},
        {"industry": "casino"},
        {"scenario_id": "Monday Ransomware"},
        {"scenario_id": "../etc/passwd"},
    ],
)
def test_rejects_invalid_runs(client: TestClient, bad: dict[str, Any]) -> None:
    assert client.post("/api/scores", json=run(**bad)).status_code == 422


def test_player_names_are_trimmed(client: TestClient) -> None:
    client.post("/api/scores", json=run(player="  Ada  "))
    board = client.get("/api/scenarios/monday-ransomware/leaderboard").json()
    assert board[0]["player"] == "Ada"


def test_leaderboard_validates_its_inputs(client: TestClient) -> None:
    assert client.get("/api/scenarios/BAD ID/leaderboard").status_code == 422
    assert client.get("/api/scenarios/monday-ransomware/leaderboard?limit=0").status_code == 422
    assert client.get("/api/scenarios/monday-ransomware/leaderboard?limit=101").status_code == 422
