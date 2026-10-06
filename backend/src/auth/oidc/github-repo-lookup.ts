import { Injectable, Logger } from '@nestjs/common';

const GITHUB_API = 'https://api.github.com';
const LOOKUP_TIMEOUT_MS = 3000;

/**
 * The result of looking a repository up on GitHub's public API:
 * - `found`: a public repository with exactly this name, and its numeric id
 * - `not_found`: private, misspelled, deleted or renamed (GitHub answers a
 *   renamed repository with a redirect, which is not followed)
 * - `unavailable`: GitHub could not be asked (timeout, rate limit, 5xx)
 */
export type RepoLookupResult =
  | { status: 'found'; id: string }
  | { status: 'not_found' }
  | { status: 'unavailable' };

/**
 * Looks up a repository's numeric id so a new trust policy can be pinned
 * before its first workflow run. Unauthenticated, so only public
 * repositories are visible, and GitHub allows 60 lookups an hour per IP.
 * Callers treat anything but `found` as "pin on first use".
 */
@Injectable()
export class GithubRepoLookup {
  private readonly logger = new Logger(GithubRepoLookup.name);

  async lookup(repository: string): Promise<RepoLookupResult> {
    const [owner, name] = repository.split('/');
    const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'KrakenKey',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `GitHub repository lookup for ${repository} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { status: 'unavailable' };
    }

    if (res.status === 404 || (res.status >= 300 && res.status < 400)) {
      return { status: 'not_found' };
    }
    if (!res.ok) {
      this.logger.warn(
        `GitHub repository lookup for ${repository} returned ${res.status}`,
      );
      return { status: 'unavailable' };
    }

    let body: { id?: unknown; full_name?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { status: 'unavailable' };
    }
    const id =
      typeof body.id === 'number' && Number.isSafeInteger(body.id)
        ? String(body.id)
        : null;
    const sameName =
      typeof body.full_name === 'string' &&
      body.full_name.toLowerCase() === repository.toLowerCase();
    if (!id || !sameName) return { status: 'not_found' };
    return { status: 'found', id };
  }
}
