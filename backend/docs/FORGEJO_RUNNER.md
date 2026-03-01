# Running GitHub-compatible workflows on Forgejo

Goal: run the existing GitHub Actions workflow (`.github/workflows/docker-publish.yml`) on a Forgejo-hosted repository by using a self-hosted runner that supports the GitHub Actions runner protocol.

Overview
- The workflow was kept GitHub Actions-compatible so you can run the same YAML on GitHub, locally with `act`, or on Forgejo if a compatible runner is registered.
- The job in `.github/workflows/docker-publish.yml` is configured to run on a self-hosted runner with the labels `self-hosted` and `forgejo-runner`.

Options for Forgejo
1. Forgejo Actions-compatible runner (recommended)
   - If your Forgejo instance provides an Actions runner compatible with the GitHub Actions runner protocol (many Gitea/Fork forks provide this), install the official runner and register it to your Forgejo server with the label `forgejo-runner`.

2. Use a self-hosted CI executor (Drone/Woodpecker) that executes the same Docker build steps
   - If you prefer Drone/Woodpecker you can convert the steps to a `.drone.yml` pipeline; see `CI_CD.md` for the build/push steps to reproduce.

Registering a GitHub Actions-compatible runner (example with GitHub Actions runner software)
> Note: Replace `FORGEJO_BASE_URL` and `RUNNER_TOKEN` with the values your Forgejo admin UI provides for registering runners.

```bash
# Example: create a directory for the runner
mkdir -p /opt/forgejo-runner && cd /opt/forgejo-runner

# Download latest runner (Linux x64)
curl -O -L https://github.com/actions/runner/releases/download/v2.309.0/actions-runner-linux-x64-2.309.0.tar.gz

# Extract
tar xzf ./actions-runner-linux-x64-2.309.0.tar.gz

# Configure runner against your Forgejo instance
# The Forgejo UI should provide an equivalent registration URL and token for self-hosted runners
./config.sh --url https://FORGEJO_BASE_URL/REPO_OR_ORG_PATH --token RUNNER_TOKEN --labels "forgejo-runner,self-hosted"

# Run the runner as a service (systemd example)
sudo ./svc.sh install
sudo ./svc.sh start
```

Notes and caveats
- Forgejo must expose the same actions runner registration endpoints as GitHub (many forks or plugins provide this). If your Forgejo build doesn't support the runner API, use a CI engine (Drone/Woodpecker/Runner) that integrates with Forgejo's pipeline triggers.
- GitHub-hosted runners (ubuntu-latest) are not available when running on your Forgejo server — you must use an installed self-hosted runner.
- For registries using self-signed TLS, a runner using Docker client will need the CA in `/etc/docker/certs.d/<registry-host>:<port>/ca.crt` or Docker daemon configured to trust it.

Secrets and environment
- The workflow expects the following repository secrets to be set in Forgejo (or in your CI runner environment):
  - `REGISTRY_URL` — registry host (e.g. registry.example.com:5000)
  - `REGISTRY_USERNAME` — username or service account
  - `REGISTRY_PASSWORD` — password or token
  - `IMAGE_NAME` — image repo name (e.g. myorg/backend)

If your Forgejo UI doesn't provide a secrets store, set these as environment variables on the runner host or in the runner's service configuration.

Testing locally
- For smoke-testing the workflow YAML locally, use `act` to run GitHub Actions workflows on your machine.

```bash
# Install act (if not installed)
# Mac/Linux: brew install act   (or see https://github.com/nektos/act)

# Run the workflow (example)
act -j build-and-push --secret REGISTRY_URL=registry.example.com:5000 --secret REGISTRY_USERNAME=user --secret REGISTRY_PASSWORD=pass --secret IMAGE_NAME=myorg/backend
```

If you want, I can:
- Add a systemd unit template and example runner service configuration.
- Convert the GitHub Actions steps to a `.drone.yml` compatible with Forgejo's Drone integration.
- Add instructions for installing registry CA for Docker on the runner host.
