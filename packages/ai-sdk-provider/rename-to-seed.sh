#!/usr/bin/env bash
# rename-to-seed.sh
# Renames all "volcengine" → "seed" occurrences inside packages/ai-sdk-volcengine,
# and updates the npm package name:
#   @sweetretry/ai-sdk-volcengine-adapter  →  @seed-kit/ai-sdk-provider
#
# Also patches the monorepo root package.json name and any workspace
# references found in the repo.
#
# Usage:
#   cd packages/ai-sdk-volcengine
#   bash rename-to-seed.sh          # dry-run (shows what will change)
#   bash rename-to-seed.sh --apply  # actually apply changes

set -euo pipefail

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
SRC="$ROOT/src"

# ── helpers ──────────────────────────────────────────────────────────────────

log()  { echo "  $*"; }
info() { echo "[INFO] $*"; }
sep()  { echo "─────────────────────────────────────────────────────────────"; }

# Replace text inside a file (in-place), applying ALL substitution rules.
replace_content() {
  local file="$1"

  if $APPLY; then
    sed -i '' \
      -e 's/@sweetretry\/ai-sdk-volcengine-adapter/@seed-kit\/ai-sdk-provider/g' \
      -e 's/ai-sdk-volcengine-adapter-monorepo/seed-kit-monorepo/g'              \
      -e 's/ai-sdk-volcengine-adapter/ai-sdk-provider/g'                         \
      -e 's/VolcEngine/Seed/g'                                                   \
      -e 's/VOLCENGINE/SEED/g'                                                   \
      -e 's/Volcengine/Seed/g'                                                   \
      -e 's/volcengine/seed/g'                                                   \
      "$file"
  else
    if grep -qEi 'volcengine|sweetretry/ai-sdk|ai-sdk-volcengine-adapter-monorepo' "$file" 2>/dev/null; then
      log "content → ${file#"$REPO_ROOT/"}"
    fi
  fi
}

# Rename a single file, replacing "volcengine" in the basename.
rename_file() {
  local old="$1"
  local dir
  dir="$(dirname "$old")"
  local base
  base="$(basename "$old")"
  local new_base
  new_base="${base//volcengine/seed}"
  new_base="${new_base//Volcengine/Seed}"
  new_base="${new_base//VolcEngine/Seed}"
  new_base="${new_base//VOLCENGINE/SEED}"

  if [[ "$base" != "$new_base" ]]; then
    local new="$dir/$new_base"
    local rel="${old#"$ROOT/"}"
    if $APPLY; then
      mv "$old" "$new"
      log "rename  $rel  →  $new_base"
    else
      log "rename  $rel  →  $new_base"
    fi
  fi
}

# ── 1. Replace content ────────────────────────────────────────────────────────

sep
info "Step 1 – Replace text content"
sep

# Files inside the package (src + package.json + README)
while IFS= read -r -d '' file; do
  replace_content "$file"
done < <(find "$SRC" "$ROOT/package.json" "$ROOT/README.md" \
           -type f \( -name "*.ts" -o -name "*.json" -o -name "*.md" \) \
           ! -path "*/node_modules/*" \
           -print0)

# Monorepo root package.json and README (package name, install snippet)
for f in "$REPO_ROOT/package.json" "$REPO_ROOT/README.md"; do
  [[ -f "$f" ]] && replace_content "$f"
done

# ── 2. Rename files (deepest first) ──────────────────────────────────────────

sep
info "Step 2 – Rename files"
sep

while IFS= read -r -d '' file; do
  rename_file "$file"
done < <(find "$SRC" \
           -type f \( -name "*volcengine*" -o -name "*Volcengine*" -o -name "*VolcEngine*" \) \
           ! -path "*/node_modules/*" \
           -print0 \
         | sort -z -r)

# ── 3. Rename the package directory itself ────────────────────────────────────

sep
info "Step 3 – Rename package directory"
sep

PACKAGE_DIR="$(dirname "$ROOT")/ai-sdk-volcengine"
NEW_PACKAGE_DIR="$(dirname "$ROOT")/ai-sdk-provider"

if [[ -d "$PACKAGE_DIR" ]]; then
  if $APPLY; then
    mv "$PACKAGE_DIR" "$NEW_PACKAGE_DIR"
    log "rename  packages/ai-sdk-volcengine  →  packages/ai-sdk-provider"
  else
    log "rename  packages/ai-sdk-volcengine  →  packages/ai-sdk-provider"
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────

sep
if $APPLY; then
  info "Done. All renames applied."
  info "Next steps:"
  echo "  1. pnpm install          (regenerate lockfile)"
  echo "  2. pnpm typecheck        (verify no broken imports)"
  echo "  3. pnpm test             (run all tests)"
else
  info "Dry-run complete. Run with --apply to execute changes."
fi
sep
