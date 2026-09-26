#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_command docker

MYSQL_CONTAINER="${NXDI_MYSQL_CONTAINER:-mysql}"
DATABASE_NAME="${NXDI_DATABASE_NAME:-nxdi}"
BACKUP_DIR="${NXDI_BACKUP_DIR:-${HOME}/Downloads/nxdi-backups}"

legacy_tables=(
  "PortfolioHolding"
  "PortfolioDailySnapshot"
  "DividendRecord"
  "monthly_dividend_records"
  "Disclosure"
  "DisclosureTrade"
  "roadmap_events"
  "InvestmentIntent"
  "WithdrawalIntent"
)

target_tables=(
  "tb_portfolio_holdings"
  "tb_portfolio_daily_snapshots"
  "tb_dividend_records"
  "tb_monthly_dividend_records"
  "tb_disclosures"
  "tb_disclosure_trades"
  "tb_roadmap_events"
  "tb_investment_intents"
  "tb_withdrawal_intents"
)

cleanup_completed_backups() {
  local backups=()
  shopt -s nullglob
  backups=("${BACKUP_DIR}"/nxdi-before-table-rename-*.sql)
  shopt -u nullglob

  if (( ${#backups[@]} == 0 )); then
    return 0
  fi

  rm -f -- "${backups[@]}"
  echo "Removed ${#backups[@]} completed table-rename backup(s)."
}

mysql_exec() {
  docker exec -i "$MYSQL_CONTAINER" sh -c \
    'exec mysql --protocol=socket --user=root --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names "$0"' \
    "$DATABASE_NAME"
}

mysql_dump() {
  docker exec "$MYSQL_CONTAINER" sh -c \
    'exec mysqldump --protocol=socket --user=root --password="$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$0"' \
    "$DATABASE_NAME"
}

query() {
  printf '%s\n' "$1" | mysql_exec
}

sql_string_list() {
  local output=""
  local name
  for name in "$@"; do
    if [[ -n "$output" ]]; then
      output+=","
    fi
    output+="'${name}'"
  done
  printf '%s' "$output"
}

table_count() {
  local list
  list="$(sql_string_list "$@")"
  query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${DATABASE_NAME}' AND table_name IN (${list});"
}

capture_row_counts() {
  local output_file="$1"
  shift
  local table
  : > "$output_file"
  for table in "$@"; do
    printf '%s\t' "$table" >> "$output_file"
    query "SELECT COUNT(*) FROM \`${table}\`;" >> "$output_file"
  done
}

docker inspect "$MYSQL_CONTAINER" >/dev/null

legacy_count="$(table_count "${legacy_tables[@]}")"
target_count="$(table_count "${target_tables[@]}")"
expected_count="${#legacy_tables[@]}"

if [[ "$legacy_count" == "0" && "$target_count" == "$expected_count" ]]; then
  cleanup_completed_backups
  echo "NXDI tables already use the canonical tb_ names."
  exit 0
fi

if [[ "$legacy_count" != "$expected_count" || "$target_count" != "0" ]]; then
  echo "Refusing a partial table rename (legacy=${legacy_count}, target=${target_count})." >&2
  exit 1
fi

total_tables="$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${DATABASE_NAME}' AND table_type = 'BASE TABLE';")"
if [[ "$total_tables" != "$expected_count" ]]; then
  echo "Unexpected table count in ${DATABASE_NAME}: ${total_tables}; expected ${expected_count}." >&2
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${BACKUP_DIR}/nxdi-before-table-rename-${timestamp}.sql"
before_counts="$(mktemp)"
after_counts="$(mktemp)"
before_values="${before_counts}.values"
after_values="${after_counts}.values"
trap 'rm -f "$before_counts" "$after_counts" "$before_values" "$after_values"' EXIT

capture_row_counts "$before_counts" "${legacy_tables[@]}"
mysql_dump > "$backup_file"
chmod 600 "$backup_file"
test -s "$backup_file"

rename_sql="RENAME TABLE"
for index in "${!legacy_tables[@]}"; do
  if [[ "$index" != "0" ]]; then
    rename_sql+=","
  fi
  rename_sql+=" \`${legacy_tables[$index]}\` TO \`${target_tables[$index]}\`"
done
rename_sql+=";"

query "$rename_sql" >/dev/null

legacy_count="$(table_count "${legacy_tables[@]}")"
target_count="$(table_count "${target_tables[@]}")"
if [[ "$legacy_count" != "0" || "$target_count" != "$expected_count" ]]; then
  echo "Table rename verification failed (legacy=${legacy_count}, target=${target_count})." >&2
  exit 1
fi

capture_row_counts "$after_counts" "${target_tables[@]}"
cut -f2 "$before_counts" > "$before_values"
cut -f2 "$after_counts" > "$after_values"
if ! diff -u "$before_values" "$after_values"; then
  echo "Row counts changed during table rename." >&2
  exit 1
fi
invalid_foreign_keys="$(query "SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema = '${DATABASE_NAME}' AND referenced_table_name IS NOT NULL AND (table_name NOT LIKE 'tb\\_%' OR referenced_table_name NOT LIKE 'tb\\_%');")"
if [[ "$invalid_foreign_keys" != "0" ]]; then
  echo "Foreign-key verification failed after table rename." >&2
  exit 1
fi

cleanup_completed_backups
echo "Renamed ${expected_count} NXDI tables. Backup removed after verification."
