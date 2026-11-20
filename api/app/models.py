"""Database tables."""

from datetime import UTC, datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Share(Base):
    """A save file published under a short random id, so it can be opened in another browser."""

    __tablename__ = "shares"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    business_name: Mapped[str] = mapped_column(String(60))
    industry: Mapped[str | None] = mapped_column(String(32))
    size_bytes: Mapped[int] = mapped_column(Integer)
    # The save JSON exactly as received. The browser engine validates it again on load
    # (schema + snapshot hash), so the server never has to interpret simulation state.
    payload: Mapped[str] = mapped_column(Text)
    opens: Mapped[int] = mapped_column(Integer, default=0)


class Score(Base):
    """One finished scenario run on a leaderboard."""

    __tablename__ = "scores"
    __table_args__ = (Index("ix_scores_board", "scenario_id", "score"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    scenario_id: Mapped[str] = mapped_column(String(48))
    player: Mapped[str] = mapped_column(String(24))
    industry: Mapped[str] = mapped_column(String(32))
    score: Mapped[int] = mapped_column(Integer)
    grade: Mapped[str] = mapped_column(String(1))
    # Seed and snapshot hash of the final state: enough to re-verify the run later by replaying it.
    seed: Mapped[int] = mapped_column(BigInteger)
    state_hash: Mapped[str] = mapped_column(String(64))
