"""FastAPI application.

Endpoints (all JSON):
  GET  /api/health                              liveness and database check
  POST /api/shares                              publish a save, returns a short id
  GET  /api/shares/{id}                         fetch a published save
  POST /api/scores                              submit a finished scenario run
  GET  /api/scenarios/{scenario_id}/leaderboard top runs for a scenario

Run locally:  uvicorn app.main:create_app --factory --reload
"""

import json
import secrets
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import Database
from .models import Score, Share
from .schemas import (
    SCENARIO_PATTERN,
    SaveFile,
    ScoreAccepted,
    ScoreIn,
    ScoreOut,
    ShareCreated,
    ShareInfo,
    grade_for,
)


def get_session(request: Request) -> Iterator[Session]:
    db: Database = request.app.state.db
    yield from db.session()


SessionDep = Annotated[Session, Depends(get_session)]


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    db = Database(settings.database_url)
    db.create_all()

    app = FastAPI(title="Honeypot API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.state.db = db
    app.state.settings = settings

    @app.middleware("http")
    async def limit_body_size(request: Request, call_next):  # type: ignore[no-untyped-def]
        # Reject oversized bodies before reading them. Chunked uploads without a length are
        # still bounded by the size check in `create_share`.
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.max_save_bytes + 4096:
            return JSONResponse({"detail": "Request body too large"}, status_code=413)
        return await call_next(request)

    @app.get("/api/health")
    def health(s: SessionDep) -> dict[str, str]:
        s.execute(text("SELECT 1"))
        return {"status": "ok"}

    @app.post("/api/shares", status_code=status.HTTP_201_CREATED)
    def create_share(save: SaveFile, request: Request, s: SessionDep) -> ShareCreated:
        payload = save.model_dump_json()
        size = len(payload.encode())
        if size > settings.max_save_bytes:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Save is too large to share")
        share_id = secrets.token_urlsafe(9)  # 12 URL-safe characters, 72 bits
        s.add(
            Share(
                id=share_id,
                business_name=save.business_name(),
                industry=save.industry(),
                size_bytes=size,
                payload=payload,
            )
        )
        s.commit()
        return ShareCreated(
            id=share_id,
            url=str(request.url_for("get_share", share_id=share_id)),
            expires_days=settings.share_ttl_days,
        )

    @app.get("/api/shares/{share_id}", name="get_share")
    def get_share(share_id: Annotated[str, Path(max_length=16)], s: SessionDep) -> ShareInfo:
        share = s.get(Share, share_id)
        cutoff = datetime.now(UTC) - timedelta(days=settings.share_ttl_days)
        if share is None or _aware(share.created_at) < cutoff:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Share not found or expired")
        share.opens += 1
        s.commit()
        return ShareInfo(
            id=share.id,
            business_name=share.business_name,
            industry=share.industry,
            created_at=share.created_at,
            save=SaveFile.model_validate(json.loads(share.payload)),
        )

    @app.post("/api/scores", status_code=status.HTTP_201_CREATED)
    def submit_score(body: ScoreIn, s: SessionDep) -> ScoreAccepted:
        # Draft: scores are trusted as submitted. The seed and state hash are stored so a run can
        # later be verified by replaying it server-side (see api/README.md).
        row = Score(**body.model_dump(), grade=grade_for(body.score))
        s.add(row)
        s.commit()
        better = s.scalar(
            select(func.count())
            .select_from(Score)
            .where(Score.scenario_id == body.scenario_id, Score.score > body.score)
        )
        return ScoreAccepted(id=row.id, grade=row.grade, rank=(better or 0) + 1)

    @app.get("/api/scenarios/{scenario_id}/leaderboard")
    def leaderboard(
        scenario_id: Annotated[str, Path(pattern=SCENARIO_PATTERN, max_length=48)],
        s: SessionDep,
        limit: Annotated[int, Query(ge=1, le=100)] = 10,
    ) -> list[ScoreOut]:
        rows = s.scalars(
            select(Score)
            .where(Score.scenario_id == scenario_id)
            .order_by(Score.score.desc(), Score.created_at.asc())
            .limit(limit)
        ).all()
        return [
            ScoreOut(
                rank=i + 1,
                player=r.player,
                industry=r.industry,
                score=r.score,
                grade=r.grade,
                created_at=r.created_at,
            )
            for i, r in enumerate(rows)
        ]

    return app


def _aware(dt: datetime) -> datetime:
    """SQLite returns naive datetimes even for timezone=True columns; they are stored as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def purge_expired_shares(db: Database, ttl_days: int) -> int:
    """Deletes expired shares; run from a scheduled job. Returns the number removed."""
    cutoff = datetime.now(UTC) - timedelta(days=ttl_days)
    with db.sessions() as s:
        result = s.execute(delete(Share).where(Share.created_at < cutoff))
        s.commit()
        return result.rowcount or 0


