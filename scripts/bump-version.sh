#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

part="${1:-}"

case "$part" in
	patch|minor|major) ;;
	*)
		echo "usage: $0 <patch|minor|major>" >&2
		exit 1
		;;
esac

current="$(node -p "require('./manifest.json').version")"
IFS=. read -r major minor patch <<< "$current"

if ! [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ && "$patch" =~ ^[0-9]+$ ]]; then
	echo "invalid version: $current" >&2
	exit 1
fi

case "$part" in
	patch)
		patch=$((patch + 1))
		;;
	minor)
		minor=$((minor + 1))
		;;
	major)
		major=$((major + 1))
		;;
esac

next="$major.$minor.$patch"
min_app_version="$(node -p "require('./manifest.json').minAppVersion")"

node - "$next" "$min_app_version" <<'NODE'
const fs = require('fs');
const [version, minAppVersion] = process.argv.slice(2);

function writeJson(path, data) {
	fs.writeFileSync(path, JSON.stringify(data, null, '\t') + '\n');
}

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
packageJson.version = version;
writeJson('package.json', packageJson);

const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
packageLock.version = version;
if (packageLock.packages?.['']) {
	packageLock.packages[''].version = version;
}
writeJson('package-lock.json', packageLock);

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
manifest.version = version;
writeJson('manifest.json', manifest);

const versions = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
versions[version] = minAppVersion;
writeJson('versions.json', versions);
NODE

echo "$current -> $next"
