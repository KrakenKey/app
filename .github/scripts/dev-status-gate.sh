#!/usr/bin/env bash
# Decides whether a push to main may go to prd: it must come from a merged PR
# whose head commit carries the given dev status with state "success".
#
# Usage: dev-status-gate.sh <status-context>
#        e.g. terraform/dev-applied or deploy/dev-deployed
# Env:   GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA
# Writes allowed=true|false and reason=... to $GITHUB_OUTPUT.
set -euo pipefail

context="$1"

pr_json=$(gh api "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/pulls" \
	--jq '[.[] | select(.merged_at != null)][0] // empty')

if [[ -z $pr_json ]]; then
	allowed=false
	reason="${GITHUB_SHA:0:7} did not come from a merged PR, so nothing shows it ran on dev"
else
	pr=$(jq -r '.number' <<<"$pr_json")
	head_sha=$(jq -r '.head.sha' <<<"$pr_json")
	# The combined status endpoint returns the latest status per context.
	state=$(gh api "repos/${GITHUB_REPOSITORY}/commits/${head_sha}/status" \
		--jq ".statuses[] | select(.context == \"${context}\") | .state" | head -1)
	state="${state:-missing}"
	if [[ $state == success ]]; then
		allowed=true
	else
		allowed=false
	fi
	reason="PR #${pr} head ${head_sha:0:7}: ${context} is ${state}"
fi

{
	echo "allowed=${allowed}"
	echo "reason=${reason}"
} >>"${GITHUB_OUTPUT:-/dev/null}"
echo "allowed=${allowed}: ${reason}"
