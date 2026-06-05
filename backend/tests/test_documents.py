"""Тесты /documents."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def test_documents_crud_flow(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)

    created = client.post(
        "/api/v1/documents",
        headers=h,
        json={
            "title": "NDA Acme",
            "emoji": "📄",
            "kind": "doc",
            "section": "clients",
            "tags": ["legal", "nda"],
            "description": "Mutual NDA",
        },
    )
    assert created.status_code == 201, created.text
    doc = created.json()
    assert doc["title"] == "NDA Acme"
    assert doc["ownerUserId"] == str(admin_user.id)

    listing = client.get("/api/v1/documents?section=clients&page=1&pageSize=20", headers=h)
    assert listing.status_code == 200, listing.text
    page = listing.json()
    assert page["total"] >= 1
    assert any(x["id"] == doc["id"] for x in page["items"])

    updated = client.patch(
        f"/api/v1/documents/{doc['id']}",
        headers=h,
        json={"title": "NDA Acme v2", "description": "Updated"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "NDA Acme v2"

    # PATCH с несуществующим fileId — 422 file_not_found (валидация привязки файла).
    bad_file = client.patch(
        f"/api/v1/documents/{doc['id']}",
        headers=h,
        json={"fileId": "00000000-0000-0000-0000-000000000000"},
    )
    assert bad_file.status_code == 422, bad_file.text
    assert bad_file.json()["detail"]["code"] == "file_not_found"

    deleted = client.delete(f"/api/v1/documents/{doc['id']}", headers=h)
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True


def test_documents_favorite_versions_comments(client: TestClient, recruiter_user) -> None:
    h = auth_headers(client, recruiter_user.email)

    created = client.post(
        "/api/v1/documents",
        headers=h,
        json={
            "title": "Team Notes",
            "emoji": "📝",
            "kind": "note",
            "section": "general",
            "body": "<p>Hello</p>",
        },
    )
    assert created.status_code == 201, created.text
    doc = created.json()

    fav = client.put(
        f"/api/v1/documents/{doc['id']}/favorite",
        headers=h,
        json={"favorite": True},
    )
    assert fav.status_code == 200

    by_id = client.get(f"/api/v1/documents/{doc['id']}", headers=h)
    assert by_id.status_code == 200
    assert by_id.json()["isFavorite"] is True

    ver = client.post(
        f"/api/v1/documents/{doc['id']}/versions",
        headers=h,
        json={"label": "v2", "note": "small edit"},
    )
    assert ver.status_code == 201, ver.text
    assert ver.json()["label"] == "v2"

    comment = client.post(
        f"/api/v1/documents/{doc['id']}/comments",
        headers=h,
        json={"text": "Looks good"},
    )
    assert comment.status_code == 201, comment.text
    assert comment.json()["text"] == "Looks good"

    versions = client.get(f"/api/v1/documents/{doc['id']}/versions", headers=h)
    assert versions.status_code == 200
    assert len(versions.json()) == 1

    comments = client.get(f"/api/v1/documents/{doc['id']}/comments", headers=h)
    assert comments.status_code == 200
    assert len(comments.json()) == 1

