#!/usr/bin/env bash
# [LAW:one-source-of-truth] src/ is the source; dist/ is its committed build output,
# shipped because action.yml runs dist/index.js. This rebuilds and fails when the
# committed copy differs from what src/ and the lockfile produce. dist/ is cleared first so a
# tracked file the build no longer produces shows up as deleted.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
pnpm run build

stale=$(git status --porcelain --untracked-files=all -- dist)
if [[ -n "$stale" ]]; then
  echo "ERROR: dist/ is stale: it differs from a fresh build of src/." >&2
  echo "$stale" >&2
  git --no-pager diff --stat -- dist >&2
  echo "Fix: pnpm install --frozen-lockfile && pnpm run build, then commit dist/." >&2
  exit 1
fi
echo "dist/ matches a fresh build ($(git ls-files dist | wc -l | tr -d ' ') files)."
