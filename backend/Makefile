.PHONY: help install dev lint typecheck test fmt migrate revision seed run

help:
	@echo "make install     — установить зависимости (dev + prod)"
	@echo "make run         — запустить uvicorn на :8000"
	@echo "make dev         — uvicorn с --reload"
	@echo "make lint        — ruff check"
	@echo "make typecheck   — mypy"
	@echo "make fmt         — ruff format"
	@echo "make test        — pytest"
	@echo "make revision m='msg' — новая alembic-ревизия"
	@echo "make migrate     — alembic upgrade head"
	@echo "make seed        — создать admin из .env"

install:
	pip install -e ".[dev]"

run:
	uvicorn app.main:app --host 0.0.0.0 --port 8000

dev:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

lint:
	ruff check app tests

fmt:
	ruff format app tests

typecheck:
	mypy app

test:
	pytest

revision:
	alembic revision --autogenerate -m "$(m)"

migrate:
	alembic upgrade head

seed:
	python -m scripts.seed_admin
	python -m scripts.seed_permissions

seed-from-mocks:
	python -m scripts.seed_from_mocks
