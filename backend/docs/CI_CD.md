# CI/CD — Docker image build & publish

This project includes a GitHub Actions workflow that builds the Docker image for the `backend` service and pushes it to a configurable, self-hosted Docker registry (your "forge" repo).

Workflow path: `.github/workflows/docker-publish.yml`

What it does
- Runs on `push` to `main/master`, on pull requests to those branches, and on manual dispatch.
- Builds the Docker image using the `backend/Dockerfile` and pushes two tags: `:latest` and a commit-specific tag `:${{ github.sha }}`.

Required repository secrets
- `REGISTRY_URL` — hostname (and optional port) for your registry, e.g. `registry.example.com` or `registry.example.com:5000`
- `REGISTRY_USERNAME` — username with push permission
- `REGISTRY_PASSWORD` — password or token for the user
- `IMAGE_NAME` — image name (repository) to push, e.g. `myorg/backend`

Example workflow snippet (already applied to `.github/workflows/docker-publish.yml`):
```yaml
- name: Log in to registry
	uses: docker/login-action@v2
	with:
		registry: ${{ secrets.REGISTRY_URL }}
		username: ${{ secrets.REGISTRY_USERNAME }}
		password: ${{ secrets.REGISTRY_PASSWORD }}

- name: Build and push
	uses: docker/build-push-action@v5
	with:
		context: ./backend
		file: ./backend/Dockerfile
		push: true
		tags: |
			${{ secrets.REGISTRY_URL }}/${{ secrets.IMAGE_NAME }}:latest
			${{ secrets.REGISTRY_URL }}/${{ secrets.IMAGE_NAME }}:${{ github.sha }}
```

Example secret values
- `REGISTRY_URL`: registry.myforge.internal:5000
- `IMAGE_NAME`: myorg/backend

How to add the secrets on GitHub
1. Go to your repository → Settings → Secrets and variables → Actions → New repository secret.
2. Add `REGISTRY_URL`, `REGISTRY_USERNAME`, `REGISTRY_PASSWORD`, and `IMAGE_NAME`.

Testing locally before pushing
1. Build locally:
```bash
docker build -t registry.example.com/myorg/backend:local -f backend/Dockerfile ./backend
```
2. Push locally (example using a generic registry):
```bash
docker tag registry.example.com/myorg/backend:local registry.example.com/myorg/backend:dev
docker push registry.example.com/myorg/backend:dev
```

Notes
- The workflow builds from the `./backend` context and uses the `backend/Dockerfile` that already exists in the repo.
- If your registry uses self-signed TLS, you may need to configure your runner or registry to trust that certificate (GitHub-hosted runners cannot be modified; use self-hosted runners if you need custom trust stores).
- If you prefer another CI provider (GitLab CI, Jenkins, etc.), I can provide equivalent pipeline configuration.

Want me to:
- add a small `ci/publish.sh` helper script in the repo? 
- or add an example `deploy` step that notifies your forge or triggers a release?
