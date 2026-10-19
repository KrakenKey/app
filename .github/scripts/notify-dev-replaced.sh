#!/usr/bin/env bash
# After main is deployed to dev, tells the open PR that was on dev that dev
# no longer runs its head commit, so nobody keeps testing main thinking it's
# the PR. Comments once per PR head commit.
#
# Usage: notify-dev-replaced.sh
# Env:   GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_SERVER_URL,
#        GITHUB_RUN_ID, DRY_RUN=1 to print the comment instead of posting it
set -euo pipefail

# The PR most recently deployed to dev: the newest successful "Dev deploy"
# run whose deploy job actually ran (a run without image changes skips it).
# GitHub empties a run's pull_requests once the PR is closed, so a deploy
# with no PR number belongs to a merged or closed PR: nobody to tell.
found=""
pr=""
head_sha=""
runs=$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/deploy-dev.yml/runs?event=pull_request&status=success&per_page=20" \
	--jq '.workflow_runs[] | [.id, .head_sha, (.pull_requests[0].number // "-")] | @tsv')
while IFS=$'\t' read -r id sha number; do
	[[ -n $id ]] || continue
	deployed=$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${id}/jobs" \
		--jq '.jobs[] | select(.name == "Deploy to dev") | .conclusion')
	if [[ $deployed == success ]]; then
		found=1
		[[ $number != - ]] && pr=$number
		head_sha=$sha
		break
	fi
done <<<"$runs"

if [[ -z $found ]]; then
	echo "No PR deploy to dev found"
	exit 0
fi
if [[ -z $pr ]]; then
	echo "The last PR on dev (${head_sha:0:7}) is merged or closed; nothing to say"
	exit 0
fi

read -r state current_head < <(gh pr view "$pr" -R "$GITHUB_REPOSITORY" \
	--json state,headRefOid --jq '"\(.state) \(.headRefOid)"')
# A merged PR is now part of main; a PR that moved on has a newer head whose
# dev-deployed status is already pending.
if [[ $state != OPEN || $current_head != "$head_sha" ]]; then
	echo "#${pr} (${head_sha:0:7}) is ${state}, head ${current_head:0:7}; nothing to say"
	exit 0
fi

marker="<!-- dev-replaced:${head_sha} -->"
if gh api "repos/${GITHUB_REPOSITORY}/issues/${pr}/comments?per_page=100" --paginate \
	--jq '.[].body' | grep -qF "$marker"; then
	echo "#${pr} was already told dev moved off ${head_sha:0:7}"
	exit 0
fi

body="${marker}
Dev now runs \`main\` at ${GITHUB_SHA:0:7} ([deploy](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})), not this PR's ${head_sha:0:7}. Add the \`deploy:dev\` label again to put this PR back on dev before testing it there."

if [[ ${DRY_RUN:-} == 1 ]]; then
	echo "Would comment on #${pr}:"
	echo "$body"
else
	gh pr comment "$pr" -R "$GITHUB_REPOSITORY" --body "$body" >/dev/null
	echo "Told #${pr} that dev now runs main at ${GITHUB_SHA:0:7}"
fi
