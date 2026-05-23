"""DTO модуля matching."""
from __future__ import annotations

import uuid
from datetime import datetime

from app.core.schemas import CamelModel
from app.modules.matching.models import MatchStatus


class VacancyCandidateResponse(CamelModel):
    id: uuid.UUID
    vacancy_id: uuid.UUID
    candidate_id: uuid.UUID
    status: MatchStatus
    added_by_id: uuid.UUID | None = None
    added_at: datetime
    feedback: str | None = None


class AttachRequest(CamelModel):
    candidate_id: uuid.UUID


class UpdateMatchRequest(CamelModel):
    status: MatchStatus | None = None
    feedback: str | None = None
