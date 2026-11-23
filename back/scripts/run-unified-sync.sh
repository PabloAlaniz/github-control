#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="${GITHUB_CONTROL_CACHE_DIR:-$HOME/.cache/github-control-snapshot}"

cd "$PROJECT_DIR"

echo "=== Unified Sync Pipeline ==="
echo "Cache: $CACHE_DIR"
echo ""

# Phase 1: Rust clone/cache/LOC (~30s with cache)
echo "Phase 1: Rust clone/cache..."
cargo run --release \
  --manifest-path scripts/daily-snapshot-clone-rust/Cargo.toml \
  -- --cache-dir "$CACHE_DIR" "$@"

echo ""

# Phase 2+3: Node analyzers + GitHub API enrichment
echo "Phase 2+3: Analyzers + API enrichment..."
npx tsx scripts/unified-sync.ts \
  --analyze-only \
  --cache-dir "$CACHE_DIR" \
  "$@"

echo ""
echo "=== Unified Sync Complete ==="
