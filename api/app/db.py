"""Database engine and session handling (SQLAlchemy 2.0)."""

from collections.abc import Iterator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        # One shared connection for in-memory test databases; thread check off for FastAPI's threadpool.
        kwargs: dict[str, object] = {"connect_args": {"check_same_thread": False}}
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
        return create_engine(url, **kwargs)  # type: ignore[arg-type]
    return create_engine(url, pool_pre_ping=True)


class Database:
    def __init__(self, url: str) -> None:
        self.engine = make_engine(url)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    def create_all(self) -> None:
        # Draft: tables are created at start-up. A real deployment would use Alembic migrations.
        from . import models  # noqa: F401  (registers the tables)

        Base.metadata.create_all(self.engine)

    def session(self) -> Iterator[Session]:
        with self.sessions() as s:
            yield s
