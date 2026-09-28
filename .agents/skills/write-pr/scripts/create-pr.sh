#!/bin/bash
set -e

TITLE="${1:?Error: PR title is required. Usage: create-pr.sh <title> <body-file> [label1,label2,...]}"
BODY_FILE="${2:?Error: Body file is required. Usage: create-pr.sh <title> <body-file> [label1,label2,...]}"
LABELS="${3:-}"

if [ ! -f "$BODY_FILE" ]; then
  echo "ERROR: Body file not found: $BODY_FILE" >&2
  exit 1
fi

CURRENT=$(git branch --show-current)
ORIGIN=$(git remote get-url origin)
ORIGIN=${ORIGIN%/}
ORIGIN=${ORIGIN%.git}
REPO_ARGS=()

# Temporary repository override; remove on return (see REPOSITORY_RETURN_GUIDE.md).
case "$ORIGIN" in
  https://github.com/tmp-it-play/nxdi|git@github.com:tmp-it-play/nxdi|ssh://git@github.com/tmp-it-play/nxdi)
    if [ -z "$CURRENT" ] || [ "$CURRENT" = "main" ]; then
      echo "ERROR: Create a work branch from origin/main before opening a PR." >&2
      exit 1
    fi
    BASE="main"
    REPO_ARGS=(--repo tmp-it-play/nxdi)
    ;;
  *)
    case "$CURRENT" in
      feature/*)  BASE="develop" ;;
      develop)    BASE="master" ;;
      *)          BASE=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || echo "develop") ;;
    esac
    ;;
esac

ARGS=(gh pr create "${REPO_ARGS[@]}" --title "$TITLE" --body-file "$BODY_FILE" --base "$BASE")

if [ -n "$LABELS" ]; then
  IFS=',' read -ra LABEL_ARRAY <<< "$LABELS"
  for label in "${LABEL_ARRAY[@]}"; do
    trimmed=$(echo "$label" | xargs)
    [ -n "$trimmed" ] && ARGS+=(--label "$trimmed")
  done
fi

echo "Creating PR..."
echo "  Title : $TITLE"
echo "  Base  : $BASE"
[ -n "$LABELS" ] && echo "  Labels: $LABELS"
echo ""

"${ARGS[@]}"
