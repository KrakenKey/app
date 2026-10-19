#!/bin/sh
# Runs a command and retries it when it fails, for steps that break on
# transient network errors, such as a 502 from the npm registry during
# `yarn install`. POSIX sh, so it also runs in the Alpine and slim images.
#
# Usage: retry.sh <command> [args...]
# Env:   RETRY_ATTEMPTS (default 3), RETRY_DELAY seconds before the second
#        attempt, doubled for each one after it (default 15)
set -u

attempts="${RETRY_ATTEMPTS:-3}"
delay="${RETRY_DELAY:-15}"
n=1
while :; do
	"$@" && exit 0
	status=$?
	if [ "$n" -ge "$attempts" ]; then
		echo "retry.sh: '$*' failed ${n} times, giving up" >&2
		exit "$status"
	fi
	echo "retry.sh: '$*' failed (attempt ${n} of ${attempts}, exit ${status}); retrying in ${delay}s" >&2
	sleep "$delay"
	n=$((n + 1))
	delay=$((delay * 2))
done
