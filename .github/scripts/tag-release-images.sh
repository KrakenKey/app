#!/usr/bin/env bash
# Adds version tags (X.Y.Z, X.Y and X) to the backend and frontend images
# already built from main. Nothing is rebuilt: each image keeps the digest
# that was tested on dev and deployed.
#
# The publish workflows only build an image when its paths change, so each
# image is the one built from the last commit at or before the tag that
# touched those paths. If that build is still running, this waits for it.
#
# Usage: tag-release-images.sh <tag>    e.g. v1.0.0
# Env:   GITHUB_REPOSITORY, WAIT_SECONDS (default 1200)
# Needs a full-history checkout and a docker login to ghcr.io.
set -euo pipefail

tag="$1"
version="${tag#v}"
minor="${version%.*}"
major="${version%%.*}"
registry="ghcr.io/${GITHUB_REPOSITORY,,}"
wait_seconds="${WAIT_SECONDS:-1200}"

tag_image() {
	local name="$1"
	shift
	local commit image source deadline
	commit=$(git log -1 --format=%H "$tag" -- "$@")
	if [[ -z $commit ]]; then
		echo "::error::no commit at or before ${tag} touches ${name}" >&2
		return 1
	fi
	image="${registry}/${name}"
	# docker/metadata-action's type=sha tag: "sha-" plus a 7-character short sha.
	source="${image}:sha-${commit:0:7}"
	deadline=$((SECONDS + wait_seconds))
	until docker buildx imagetools inspect "$source" >/dev/null 2>&1; do
		if ((SECONDS >= deadline)); then
			echo "::error::${source} not found after ${wait_seconds}s. Check that its build on main succeeded." >&2
			return 1
		fi
		echo "Waiting for ${source}"
		sleep 30
	done
	docker buildx imagetools create \
		--tag "${image}:${version}" --tag "${image}:${minor}" --tag "${image}:${major}" \
		"$source"
	echo "${image}:${version}, :${minor} and :${major} now point at ${source}"
}

# Same paths as the publish workflows' push filters.
tag_image backend backend shared .github/workflows/backend-docker-publish.yml
tag_image frontend frontend shared .github/workflows/frontend-docker-publish.yml
