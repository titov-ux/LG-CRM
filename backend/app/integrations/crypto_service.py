"""Клиент `crypto-service` — сервис УНЭП ЛГ на КриптоПро JCP.

Сервис живёт в отдельном контейнере во внутренней сети (паттерн stt-service)
и держит закрытые ключи сотрудников. Бэкенд к ключам доступа не имеет и может
только попросить подписать конкретный хеш, предъявив одноразовый
`activation_token` — его бэкенд выдаёт ТОЛЬКО после проверки SMS-кода
(см. hr_edo/signing.py). Контракт:

| метод | что делает |
|---|---|
| `POST /keys` | ключевая пара ГОСТ 34.10-2012 256 → `{keyId, publicKey}` |
| `POST /sign` | `{keyId, digest, activationToken}` → отсоединённая CAdES-T |
| `POST /verify` | проверка CAdES (УНЭП ЛГ по открытому ключу, УКЭП — по цепочке) |
| `POST /keys/{id}/revoke` | отзыв ключа |

Без `CRYPTO_SERVICE_URL` в ENV=dev работает `NoopCryptoService`: подпись
помечается как тестовая (`isTest=true`) и не имеет юридической силы. Он
проверяет activation_token так же строго, как боевой сервис, — поэтому
контрактные тесты «без кода подписать нельзя» осмысленны и в dev. Вне dev
no-op запрещён (core.config.validate_hr_edo_settings).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Protocol

import httpx
import jwt

from app.core.config import get_settings

ALGORITHM_GOST_256 = "GOST R 34.10-2012 256"
ACTIVATION_AUDIENCE = "crypto-service"


class CryptoServiceError(Exception):
    """Сервис недоступен или отказал. `code` — машинный код причины."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class KeyInfo:
    key_id: str
    public_key: bytes
    algorithm: str
    is_test: bool


@dataclass(frozen=True)
class SignResult:
    signature: bytes
    tsp_time: datetime | None
    is_test: bool


@dataclass(frozen=True)
class VerifyResult:
    valid: bool
    details: dict[str, Any] = field(default_factory=dict)


class CryptoService(Protocol):
    is_test: bool

    async def create_key(self, *, owner_ref: str) -> KeyInfo: ...

    async def sign(self, *, key_id: str, digest: str, activation_token: str) -> SignResult: ...

    async def verify(
        self,
        *,
        signature: bytes,
        digest: str,
        public_key: bytes | None = None,
        key_id: str | None = None,
    ) -> VerifyResult: ...

    async def revoke_key(self, *, key_id: str, reason: str) -> None: ...


def decode_activation_token(token: str) -> dict[str, Any]:
    """Проверка activation_token — то же делает crypto-service на своей стороне."""
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.hr_edo_activation_secret,
            algorithms=["HS256"],
            audience=ACTIVATION_AUDIENCE,
            options={"require": ["exp", "jti", "sub", "dig"]},
        )
    except jwt.InvalidTokenError as exc:
        raise CryptoServiceError("activation_invalid", "Недействительный activation_token") from exc


class HttpCryptoService:
    is_test = False

    def __init__(self, base_url: str, timeout: float) -> None:
        self._base = base_url.rstrip("/")
        self._timeout = timeout

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(f"{self._base}{path}", json=payload)
        except httpx.HTTPError as exc:
            raise CryptoServiceError("crypto_unavailable", "crypto-service недоступен") from exc
        if resp.status_code >= 400:
            try:
                body = resp.json()
            except ValueError:
                body = {}
            raise CryptoServiceError(
                str(body.get("code") or f"http_{resp.status_code}"),
                str(body.get("message") or "crypto-service отказал в операции"),
            )
        data: dict[str, Any] = resp.json()
        return data

    async def create_key(self, *, owner_ref: str) -> KeyInfo:
        data = await self._post("/keys", {"ownerRef": owner_ref})
        return KeyInfo(
            key_id=str(data["keyId"]),
            public_key=base64.b64decode(data["publicKey"]),
            algorithm=str(data.get("algorithm") or ALGORITHM_GOST_256),
            is_test=False,
        )

    async def sign(self, *, key_id: str, digest: str, activation_token: str) -> SignResult:
        data = await self._post(
            "/sign", {"keyId": key_id, "digest": digest, "activationToken": activation_token}
        )
        tsp = data.get("tspTime")
        return SignResult(
            signature=base64.b64decode(data["signature"]),
            tsp_time=datetime.fromisoformat(tsp) if tsp else None,
            is_test=False,
        )

    async def verify(
        self,
        *,
        signature: bytes,
        digest: str,
        public_key: bytes | None = None,
        key_id: str | None = None,
    ) -> VerifyResult:
        payload: dict[str, Any] = {
            "signature": base64.b64encode(signature).decode(),
            "digest": digest,
        }
        if public_key is not None:
            payload["publicKey"] = base64.b64encode(public_key).decode()
        if key_id is not None:
            payload["keyId"] = key_id
        data = await self._post("/verify", payload)
        return VerifyResult(valid=bool(data.get("valid")), details=dict(data))

    async def revoke_key(self, *, key_id: str, reason: str) -> None:
        await self._post(f"/keys/{key_id}/revoke", {"reason": reason})


class NoopCryptoService:
    """Dev-заглушка: «тестовая подпись» без СКЗИ.

    Подпись — JSON с HMAC(dev-секрет, keyId|digest). Её можно проверить без
    состояния, но юридической силы она не имеет: в документе, листе подписания
    и протоколе она помечена как тестовая.
    """

    is_test = True
    _MAGIC = "LG-TEST-SIGNATURE"

    def __init__(self) -> None:
        self._used_jti: set[str] = set()
        self._revoked: set[str] = set()

    @staticmethod
    def _mac(key_id: str, digest: str) -> str:
        secret = get_settings().hr_edo_activation_secret.encode()
        return hmac.new(secret, f"{key_id}|{digest}".encode(), hashlib.sha256).hexdigest()

    async def create_key(self, *, owner_ref: str) -> KeyInfo:
        public_key = hashlib.sha512(secrets.token_bytes(32) + owner_ref.encode()).digest()
        return KeyInfo(
            key_id=f"test-{uuid.uuid4()}",
            public_key=public_key,
            algorithm=f"{ALGORITHM_GOST_256} (тестовая подпись)",
            is_test=True,
        )

    async def sign(self, *, key_id: str, digest: str, activation_token: str) -> SignResult:
        claims = decode_activation_token(activation_token)
        if claims["sub"] != key_id or claims["dig"] != digest:
            raise CryptoServiceError("activation_mismatch", "Токен выдан для другого ключа или хеша")
        if claims["jti"] in self._used_jti:
            raise CryptoServiceError("activation_reused", "Токен уже использован")
        if key_id in self._revoked:
            raise CryptoServiceError("key_revoked", "Ключ отозван")
        self._used_jti.add(str(claims["jti"]))
        now = datetime.now(timezone.utc)
        body = {
            "format": self._MAGIC,
            "keyId": key_id,
            "digest": digest,
            "signedAt": now.isoformat(),
            "mac": self._mac(key_id, digest),
        }
        return SignResult(
            signature=json.dumps(body, ensure_ascii=False).encode(),
            tsp_time=now,
            is_test=True,
        )

    async def verify(
        self,
        *,
        signature: bytes,
        digest: str,
        public_key: bytes | None = None,
        key_id: str | None = None,
    ) -> VerifyResult:
        try:
            body = json.loads(signature.decode())
        except (UnicodeDecodeError, ValueError):
            # Внешняя подпись (УКЭП директора, Госключ) — проверить её без
            # КриптоПро нечем. Пропускаем с явной пометкой.
            return VerifyResult(
                valid=True,
                details={
                    "test": True,
                    "checked": False,
                    "note": "crypto-service не подключён: подпись не проверялась (dev)",
                },
            )
        if not isinstance(body, dict) or body.get("format") != self._MAGIC:
            return VerifyResult(valid=False, details={"test": True, "reason": "unknown_format"})
        ok = (
            body.get("digest") == digest
            and (key_id is None or body.get("keyId") == key_id)
            and hmac.compare_digest(str(body.get("mac")), self._mac(str(body.get("keyId")), digest))
        )
        return VerifyResult(
            valid=ok,
            details={"test": True, "checked": True, "keyId": body.get("keyId")},
        )

    async def revoke_key(self, *, key_id: str, reason: str) -> None:
        self._revoked.add(key_id)


@lru_cache(maxsize=1)
def get_crypto_service() -> CryptoService:
    settings = get_settings()
    if settings.crypto_service_url:
        return HttpCryptoService(settings.crypto_service_url, settings.crypto_service_timeout_seconds)
    return NoopCryptoService()


_override: CryptoService | None = None


def set_crypto_service_for_tests(service: CryptoService | None) -> None:
    global _override
    _override = service


def crypto_service() -> CryptoService:
    return _override or get_crypto_service()
