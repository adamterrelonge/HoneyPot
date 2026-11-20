# Honeypot API (draft)

An optional Python backend for the browser simulator. Honeypot works fully offline without it.
It adds two things the browser alone can't do:

- **Share links:** publish a save and get a short id, so a business opens in any browser with a
  link instead of a long share code.
- **Scenario leaderboards:** submit a finished scenario run and see the top scores for it.

Stack: FastAPI, Pydantic v2, SQLAlchemy 2.0. SQLite locally, PostgreSQL in production.

## Run it

```bash
cd api
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:create_app --factory --reload
```

Interactive docs are served at <http://localhost:8000/docs>.

```bash
pytest          # tests
ruff check .    # lint
mypy app        # types
```

Or with Docker: `docker build -t honeypot-api . && docker run -p 8000:8000 honeypot-api`.

## Configuration

Environment variables (or a `.env` file):

| Variable | Default | Meaning |
|---|---|---|
| `HONEYPOT_DATABASE_URL` | `sqlite:///./honeypot.db` | SQLAlchemy URL, e.g. `postgresql+psycopg://user:pass@host/db` |
| `HONEYPOT_CORS_ORIGINS` | `["http://localhost:5173","http://localhost:4173"]` | Browser origins allowed to call the API (JSON list) |
| `HONEYPOT_MAX_SAVE_BYTES` | `1000000` | Largest save accepted |
| `HONEYPOT_SHARE_TTL_DAYS` | `90` | Shares expire after this many days |

## Endpoints

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/api/health` | | `{"status": "ok"}` |
| `POST` | `/api/shares` | a save file (`format: "honeypot-save"`, `v: 1`, …) | `201 {id, url, expires_days}` |
| `GET` | `/api/shares/{id}` | | `{id, business_name, industry, created_at, save}` or `404` |
| `POST` | `/api/scores` | `{scenario_id, player, industry, score, seed, state_hash}` | `201 {id, grade, rank}` |
| `GET` | `/api/scenarios/{scenario_id}/leaderboard` | `?limit=1..100` (default 10) | ranked list |

## Design notes

- **The server never interprets simulation state.** It checks a save's envelope (format, version,
  business reference, size) and stores it as received. The browser engine validates the full save
  and checks its snapshot hash when it is opened, so a tampered save is rejected there.
- **Grades are computed server-side** from the score, using the engine's thresholds
  (A ≥ 850, B ≥ 700, C ≥ 550, D ≥ 400). Clients can't submit a grade.
- **Share ids** are 72 random bits (`secrets.token_urlsafe(9)`), so they can't be guessed.
- **Input limits:** request size is capped before the body is read; player names are trimmed,
  normalised and limited to 24 printable characters; scenario ids must be kebab-case slugs.

## Not done yet (draft)

- **Score verification.** Scores are trusted as submitted. Each run stores its seed and final
  state hash so it can later be verified by replaying the command log on the server, ideally with
  the Rust engine in `engine-rs/` once the full simulation is ported.
- **Abuse controls:** rate limiting, a profanity filter for names, and authentication.
- **Migrations:** tables are created at start-up. Production needs Alembic.
- **Frontend wiring:** the Saves sheet doesn't call the API yet. The plan is a `VITE_API_URL`
  setting that adds "Copy link" and leaderboard views when set, and hides them otherwise.
