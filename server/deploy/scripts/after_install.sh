#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_command docker

RUNTIME_ENV="${APP_DIR}/runtime.env"
APP_ENV="${APP_DIR}/.env"

if [[ ! -s "$RUNTIME_ENV" ]]; then
  echo "runtime.env is missing or empty." >&2
  exit 1
fi

umask 077
mv "$RUNTIME_ENV" "$APP_ENV"
chmod 600 "$APP_ENV"

docker info >/dev/null
docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" build --pull

"${SCRIPT_DIR}/rename_tables.sh"

# Existing installations must complete the documented, verified one-time baseline.
# migrate deploy refuses unbaselined non-empty databases; never use db push here.
docker compose -f "$COMPOSE_FILE" run --rm --no-deps server npm run db:migrate
