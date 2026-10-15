# Releasing

app deploys continuously: every merge to `main` builds the backend and frontend images and deploys them (see the publish workflows). Releases don't change that. A release gives a point on `main` a version, publishes release notes, and adds version tags to the images that were already built and deployed from it.

## Versions

Releases follow [Semantic Versioning](https://semver.org/), judged by what API clients see. The CLI, probe, connector, cert-action and the Terraform provider all depend on the API.

| Bump | When |
|------|------|
| Major | A change that breaks existing clients: a removed or renamed route or field, a changed response shape, new auth requirements, or validation that rejects requests that used to work |
| Minor | New routes, fields or features that existing clients can ignore |
| Patch | Fixes only |

A database migration doesn't decide the bump by itself; its effect on clients does.

## Cutting a release

1. Open a PR titled `chore(release): vX.Y.Z` that moves the entries under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) into a new `## [X.Y.Z] - YYYY-MM-DD` section, leaving an empty `## [Unreleased]` above it.
2. Merge it like any other PR.
3. Tag the merge commit and push the tag:

   ```bash
   git fetch origin
   git log -1 --oneline origin/main   # should be the release PR
   git tag -a vX.Y.Z -m vX.Y.Z origin/main
   git push origin vX.Y.Z
   ```

4. The [Release workflow](../.github/workflows/release.yml) then:
   - checks that the tag is `vX.Y.Z`, is on `main`, and has a changelog section;
   - tags the images built from `main` for that commit as `X.Y.Z`, `X.Y` and `X` (`ghcr.io/krakenkey/app/backend` and `ghcr.io/krakenkey/app/frontend`), without rebuilding them;
   - creates the GitHub release with the changelog section as its notes.

If the workflow fails, fix the cause and rerun it. Every step is safe to repeat.

`GET /` reports the version from `KK_API_VERSION` in the deployment's environment, so set it to the released version when deploying.
