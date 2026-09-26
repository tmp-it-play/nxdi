#!/usr/bin/env bash

set -Eeuo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

APP_DIR="${NXDI_DEPLOY_DIR:-${HOME}/Downloads/nxdi}"
COMPOSE_FILE="${APP_DIR}/deploy/compose.yml"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}
