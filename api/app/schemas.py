"""Request and response bodies.

`SaveFile` mirrors the top level of the TypeScript `SaveFileSchema` (src/engine/save/save.ts).
Only the envelope is checked here; the simulation state is opaque to the server and is fully
validated, and its hash verified, by the engine in the browser when the save is opened.
"""

import re
import unicodedata
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SAVE_FORMAT = "honeypot-save"
SAVE_VERSION = 1

INDUSTRIES = ("professional", "retail", "healthcare", "manufacturing", "education", "logistics")
Industry = Literal["professional", "retail", "healthcare", "manufacturing", "education", "logistics"]

# Same thresholds as `score()` in src/engine/incidents/engine.ts.
GRADE_THRESHOLDS = ((850, "A"), (700, "B"), (550, "C"), (400, "D"))

SCENARIO_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"
ScenarioId = Annotated[str, Field(pattern=SCENARIO_PATTERN, max_length=48)]


def grade_for(score: int) -> str:
    return next((g for limit, g in GRADE_THRESHOLDS if score >= limit), "F")


class SaveFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["honeypot-save"]
    v: Literal[1]
    business: dict[str, Any]
    seed: int
    hash: str = Field(min_length=1, max_length=64)
    state: dict[str, Any]

    @field_validator("business")
    @classmethod
    def business_ref(cls, b: dict[str, Any]) -> dict[str, Any]:
        if b.get("kind") not in ("spec", "topology"):
            raise ValueError("business.kind must be 'spec' or 'topology'")
        return b

    def business_name(self) -> str:
        if self.business["kind"] == "spec":
            name = self.business.get("spec", {}).get("name")
        else:
            name = self.business.get("topology", {}).get("meta", {}).get("name")
        return str(name)[:60] if name else "Untitled business"

    def industry(self) -> str | None:
        spec = self.business.get("spec") if self.business["kind"] == "spec" else None
        value = spec.get("industry") if isinstance(spec, dict) else None
        return value if value in INDUSTRIES else None


class ShareCreated(BaseModel):
    id: str
    url: str
    expires_days: int


class ShareInfo(BaseModel):
    id: str
    business_name: str
    industry: str | None
    created_at: datetime
    save: SaveFile


_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class ScoreIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_id: ScenarioId
    player: str = Field(min_length=1, max_length=24)
    industry: Industry
    score: int = Field(ge=0, le=1000)
    seed: int
    state_hash: str = Field(min_length=1, max_length=64)

    @field_validator("player")
    @classmethod
    def clean_player(cls, v: str) -> str:
        v = unicodedata.normalize("NFC", v).strip()
        if not v or _CONTROL.search(v):
            raise ValueError("player name must be printable text")
        return v


class ScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rank: int
    player: str
    industry: str
    score: int
    grade: str
    created_at: datetime


class ScoreAccepted(BaseModel):
    id: int
    grade: str
    rank: int
