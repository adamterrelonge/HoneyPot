"""Settings, read from environment variables prefixed with HONEYPOT_ (or a .env file)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HONEYPOT_", env_file=".env")

    # SQLite for local development; set to postgresql+psycopg://... in production.
    database_url: str = "sqlite:///./honeypot.db"
    # Origins allowed to call the API from a browser (the Vite dev server by default).
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4173"]
    # Largest save accepted, in bytes. Enterprise saves after a long game are the biggest.
    max_save_bytes: int = 1_000_000
    # Shares older than this are deleted by `purge_expired_shares`.
    share_ttl_days: int = 90


@lru_cache
def get_settings() -> Settings:
    return Settings()
