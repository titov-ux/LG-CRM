#!/usr/bin/env bash
#
# Incremental deploy script for VM:
#   - git fetch + fast-forward pull
#   - frontend build
#   - docker compose rebuild/restart
#   - alembic migrations
#   - health check
#
# Usage:
#   bash scripts/deploy-vm.sh
#   bash scripts/deploy-vm.sh --branch main
#   bash scripts/deploy-vm.sh --skip-frontend
#   bash scripts/deploy-vm.sh --skip-migrate
#
# Optional env:
#   HEALTHCHECK_URL=https://localhost/healthz
#

set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"

COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file .env.prod"
LOCK_FILE="/tmp/crm-lg-deploy.lock"
BRANCH="main"
SKIP_FRONTEND=0
SKIP_MIGRATE=0
HEALTHCHECK_URL="${HEALTHCHECK_URL:-https://localhost/healthz}"

step() { printf "\n\033[1;36m[deploy]\033[0m %s\n" "$*"; }
warn() { printf "\n\033[1;33m[deploy]\033[0m %s\n" "$*"; }
die()  { printf "\n\033[1;31m[deploy] FAIL:\033[0m %s\n" "$*"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      [[ $# -lt 2 ]] && die "--branch requires value"
      BRANCH="$2"
      shift 2
      ;;
    --skip-frontend)
      SKIP_FRONTEND=1
      shift
      ;;
    --skip-migrate)
      SKIP_MIGRATE=1
      shift
      ;;
    -h|--help)
      sed -n '1,24p' "$0"
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

if [[ -f "$LOCK_FILE" ]]; then
  die "another deploy may be running (lock: $LOCK_FILE)"
fi
trap 'rm -f "$LOCK_FILE"' EXIT
touch "$LOCK_FILE"

[[ -f .env.prod ]] || die ".env.prod not found"
[[ -f infra/nginx.conf ]] || warn "infra/nginx.conf not found (using current compose mount may fail)"

command -v git >/dev/null 2>&1 || die "git not found"
command -v docker >/dev/null 2>&1 || die "docker not found"
command -v curl >/dev/null 2>&1 || die "curl not found"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  step "switching branch: $CURRENT_BRANCH -> $BRANCH"
  git checkout "$BRANCH"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree is dirty. Commit/stash local changes before deploy."
fi

step "fetching updates from origin"
git fetch origin "$BRANCH"

step "pulling latest changes (fast-forward only)"
git pull --ff-only origin "$BRANCH"

if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
  step "building frontend"
  if ! command -v pnpm >/dev/null 2>&1; then
    warn "pnpm not found, installing globally via npm"
    command -v npm >/dev/null 2>&1 || die "npm not found, cannot install pnpm"
    npm install -g pnpm
  fi
  (cd frontend && pnpm install --frozen-lockfile && pnpm build)
else
  warn "skip frontend build"
fi

step "rebuilding and restarting services"
$COMPOSE up -d --build postgres redis backend nginx

if [[ "$SKIP_MIGRATE" -eq 0 ]]; then
  step "running migrations"
  $COMPOSE exec -T backend alembic upgrade head
else
  warn "skip migrations"
fi

step "health check"
CURL_HEALTH_OPTS=(-fsS)
if [[ "$HEALTHCHECK_URL" == https://* ]]; then
  CURL_HEALTH_OPTS+=(-k)
fi
for _ in $(seq 1 30); do
  if curl "${CURL_HEALTH_OPTS[@]}" "$HEALTHCHECK_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl "${CURL_HEALTH_OPTS[@]}" "$HEALTHCHECK_URL" >/dev/null || die "backend health check failed ($HEALTHCHECK_URL)"

step "deploy completed successfully"
echo "Branch: $BRANCH"
echo "Tip: docker compose -f infra/docker-compose.prod.yml --env-file .env.prod ps"
