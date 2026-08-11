"""Тесты /files/* с фейковым S3 (boto3 не дёргается)."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints import files as files_ep
from app.integrations.s3 import PresignedPost, S3Adapter
from app.main import app
from tests.conftest import auth_headers


@dataclass
class FakeS3:
    deleted: list[str]
    objects: dict[str, bytes]

    def presign_post(self, *, file_key: str, mime: str, max_bytes: int) -> PresignedPost:
        return PresignedPost(
            url="https://storage.yandexcloud.net/crm-lg-files",
            fields={"key": file_key, "Content-Type": mime, "policy": "fake"},
            file_key=file_key,
        )

    def presign_get(self, *, file_key: str, expires_in: int = 300) -> str:
        return f"https://download.example/{file_key}?sig=fake&exp={expires_in}"

    def download_bytes(self, *, file_key: str) -> bytes:
        if file_key not in self.objects:
            raise KeyError(file_key)
        return self.objects[file_key]

    def delete(self, *, file_key: str) -> None:
        self.deleted.append(file_key)


@pytest.fixture()
def fake_s3() -> FakeS3:
    s3 = FakeS3(deleted=[], objects={})
    app.dependency_overrides[files_ep._s3_dep] = lambda: s3
    yield s3
    app.dependency_overrides.pop(files_ep._s3_dep, None)


def _presign_payload(entity_id: uuid.UUID, **overrides) -> dict:
    p = {
        "entityType": "candidate",
        "entityId": str(entity_id),
        "originalName": "cv.pdf",
        "mime": "application/pdf",
        "size": 1024,
    }
    p.update(overrides)
    return p


def test_presign_returns_url_fields_and_key(
    client: TestClient, admin_user, fake_s3: FakeS3
) -> None:
    h = auth_headers(client, admin_user.email)
    entity_id = uuid.uuid4()
    r = client.post("/api/v1/files/presign", headers=h, json=_presign_payload(entity_id))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"].startswith("https://")
    assert body["fields"]["Content-Type"] == "application/pdf"
    assert body["fileKey"].startswith(f"candidate/{entity_id}/")
    assert body["maxBytes"] > 0


def test_presign_rejects_unsupported_mime(
    client: TestClient, admin_user, fake_s3: FakeS3
) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post(
        "/api/v1/files/presign",
        headers=h,
        json=_presign_payload(uuid.uuid4(), mime="application/x-msdownload"),
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "unsupported_mime"


def test_presign_rejects_oversize(
    client: TestClient, admin_user, fake_s3: FakeS3
) -> None:
    h = auth_headers(client, admin_user.email)
    big = 200 * 1024 * 1024  # 200 МБ
    r = client.post(
        "/api/v1/files/presign",
        headers=h,
        json=_presign_payload(uuid.uuid4(), size=big),
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "file_too_large"


def test_confirm_creates_record_and_list(
    client: TestClient, admin_user, fake_s3: FakeS3
) -> None:
    h = auth_headers(client, admin_user.email)
    entity_id = uuid.uuid4()
    pres = client.post(
        "/api/v1/files/presign", headers=h, json=_presign_payload(entity_id)
    ).json()
    file_key = pres["fileKey"]

    r = client.post(
        "/api/v1/files/confirm",
        headers=h,
        json={
            "fileKey": file_key,
            "entityType": "candidate",
            "entityId": str(entity_id),
            "originalName": "cv.pdf",
            "mime": "application/pdf",
            "size": 1024,
        },
    )
    assert r.status_code == 200, r.text
    rec = r.json()
    assert rec["scanStatus"] == "pending"
    assert rec["fileKey"] == file_key

    # повторный confirm с тем же fileKey — идемпотентный (возвращает существующую)
    r2 = client.post(
        "/api/v1/files/confirm",
        headers=h,
        json={
            "fileKey": file_key,
            "entityType": "candidate",
            "entityId": str(entity_id),
            "originalName": "cv.pdf",
            "mime": "application/pdf",
            "size": 1024,
        },
    )
    assert r2.status_code == 200
    assert r2.json()["id"] == rec["id"]

    # list по сущности
    r = client.get(
        f"/api/v1/files?entityType=candidate&entityId={entity_id}", headers=h
    )
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_confirm_rejects_wrong_file_key_prefix(
    client: TestClient, admin_user, fake_s3: FakeS3
) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post(
        "/api/v1/files/confirm",
        headers=h,
        json={
            "fileKey": "vacancy/00000000-0000-0000-0000-000000000000/abc-cv.pdf",
            "entityType": "candidate",
            "entityId": str(uuid.uuid4()),
            "originalName": "cv.pdf",
            "mime": "application/pdf",
            "size": 100,
        },
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "file_key_mismatch"


def test_download_url(client: TestClient, admin_user, fake_s3: FakeS3) -> None:
    h = auth_headers(client, admin_user.email)
    entity_id = uuid.uuid4()
    pres = client.post(
        "/api/v1/files/presign", headers=h, json=_presign_payload(entity_id)
    ).json()
    rec = client.post(
        "/api/v1/files/confirm",
        headers=h,
        json={
            "fileKey": pres["fileKey"],
            "entityType": "candidate",
            "entityId": str(entity_id),
            "originalName": "cv.pdf",
            "mime": "application/pdf",
            "size": 1024,
        },
    ).json()
    r = client.get(f"/api/v1/files/{rec['id']}/download", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["url"].startswith("https://download.example/")


def test_delete_only_owner_or_admin(
    client: TestClient, admin_user, recruiter_user, fake_s3: FakeS3
) -> None:
    # Загружает recruiter
    h_rec = auth_headers(client, recruiter_user.email)
    entity_id = uuid.uuid4()
    pres = client.post(
        "/api/v1/files/presign", headers=h_rec, json=_presign_payload(entity_id)
    ).json()
    rec = client.post(
        "/api/v1/files/confirm",
        headers=h_rec,
        json={
            "fileKey": pres["fileKey"],
            "entityType": "candidate",
            "entityId": str(entity_id),
            "originalName": "cv.pdf",
            "mime": "application/pdf",
            "size": 1024,
        },
    ).json()

    # admin удаляет (даже не свой) — ок
    h_admin = auth_headers(client, admin_user.email)
    r = client.delete(f"/api/v1/files/{rec['id']}", headers=h_admin)
    assert r.status_code == 200
    assert rec["fileKey"] in fake_s3.deleted

    # удалить ещё раз — 404
    r = client.delete(f"/api/v1/files/{rec['id']}", headers=h_admin)
    assert r.status_code == 404
