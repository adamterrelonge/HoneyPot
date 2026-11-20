# Honeypot API (draft). Build from the api/ folder:  docker build -t honeypot-api .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv

COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir ".[postgres]" \
 && useradd --system --uid 10001 honeypot \
 && mkdir -p /srv/data && chown honeypot /srv/data

USER honeypot
ENV HONEYPOT_DATABASE_URL=sqlite:////srv/data/honeypot.db
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
