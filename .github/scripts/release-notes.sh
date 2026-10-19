#!/usr/bin/env bash
# Prints the docs/CHANGELOG.md section for a release tag, for the GitHub
# release body. Fails if the tag isn't vX.Y.Z, isn't on main, or has no
# "## [X.Y.Z] - YYYY-MM-DD" section.
#
# Usage: release-notes.sh <tag>    e.g. v1.0.0
# Run from a checkout of the tag with origin/main fetched.
set -euo pipefail

tag="$1"
version="${tag#v}"

if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "::error::${tag} is not a vX.Y.Z tag" >&2
	exit 1
fi

if ! git merge-base --is-ancestor "$tag" origin/main; then
	echo "::error::${tag} is not on main" >&2
	exit 1
fi

# The section runs from its heading to the next "## " heading or "---" rule.
notes=$(awk -v heading="## [${version}]" '
	index($0, heading) == 1 { found = 1; next }
	found && (/^## / || /^---$/) { exit }
	found { print }
' docs/CHANGELOG.md)

if [[ -z ${notes//[[:space:]]/} ]]; then
	echo "::error::docs/CHANGELOG.md has no section for [${version}]" >&2
	exit 1
fi

printf '%s\n' "$notes"
