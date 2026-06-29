#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

version="$(node -p "require('./manifest.json').version")"
branch="$(git branch --show-current)"

if [[ -n "$(git status --porcelain)" ]]; then
	echo "commit changes before tagging $version" >&2
	exit 1
fi

if [[ "$branch" != "main" ]]; then
	echo "switch to main before tagging $version" >&2
	exit 1
fi

git fetch origin main --quiet

if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
	echo "push main before tagging $version" >&2
	exit 1
fi

if git rev-parse -q --verify "refs/tags/$version" >/dev/null; then
	echo "tag $version already exists locally" >&2
	exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/$version" >/dev/null 2>&1; then
	echo "tag $version already exists on origin" >&2
	exit 1
fi

git tag -a "$version" -m "$version"
git push origin "$version"
