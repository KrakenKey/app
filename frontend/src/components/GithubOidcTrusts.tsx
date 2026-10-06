import { useState, useEffect, useCallback } from 'react';
import { Workflow, Plus, Trash2, Copy, Info } from 'lucide-react';
import type { GithubOidcTrust } from '@krakenkey/shared';
import { toast } from '../utils/toast';
import { copyToClipboard } from '../utils/clipboard';
import {
  MAX_ALLOWED_REFS,
  MAX_GITHUB_OIDC_TRUSTS,
  isValidRepository,
  parseRefList,
  workflowSnippet,
} from '../utils/githubOidc';
import { useActionSet } from '../hooks/useActionSet';
import { useAccessForm } from '../hooks/useAccessForm';
import * as githubOidcService from '../services/githubOidcService';
import {
  AccessChoiceFields,
  AccessSummary,
  RestrictionFields,
} from './AccessFields';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { EmptyState } from './ui/EmptyState';

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export default function GithubOidcTrusts() {
  const [trusts, setTrusts] = useState<GithubOidcTrust[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const deletingIds = useActionSet<string>();

  const [name, setName] = useState('');
  const [repository, setRepository] = useState('');
  const [repoError, setRepoError] = useState<string | null>(null);
  const [refsText, setRefsText] = useState('');
  const [refsError, setRefsError] = useState<string | null>(null);
  const [environment, setEnvironment] = useState('');
  const [snippet, setSnippet] = useState<{
    trust: GithubOidcTrust;
    text: string;
  } | null>(null);

  const accessForm = useAccessForm();
  const { loadDomains, domainNames } = accessForm;

  const fetchTrusts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await githubOidcService.fetchGithubOidcTrusts();
      setTrusts(data);
      if (data.some((t) => t.allowedDomainIds?.length)) {
        void loadDomains();
      }
    } catch (error) {
      console.error('Failed to fetch GitHub trust policies:', error);
    } finally {
      setLoading(false);
    }
  }, [loadDomains]);

  useEffect(() => {
    fetchTrusts();
  }, [fetchTrusts]);

  const atLimit = trusts.length >= MAX_GITHUB_OIDC_TRUSTS;

  const resetForm = () => {
    setName('');
    setRepository('');
    setRepoError(null);
    setRefsText('');
    setRefsError(null);
    setEnvironment('');
    accessForm.reset();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Please enter a name for the trust policy');
      return;
    }

    const repo = repository.trim();
    if (!isValidRepository(repo)) {
      setRepoError('Enter the repository as owner/name, e.g. octo/website.');
      return;
    }

    const { entries: allowedRefs, invalid } = parseRefList(refsText);
    if (invalid.length > 0) {
      setRefsError(
        `Each entry must start with refs/ and may only end in *: ${invalid.join(', ')}`,
      );
      return;
    }
    if (allowedRefs.length > MAX_ALLOWED_REFS) {
      setRefsError(`Enter at most ${MAX_ALLOWED_REFS} branches or tags.`);
      return;
    }

    const resolved = accessForm.resolveScopes();
    if (!resolved) return;

    try {
      setCreating(true);
      const trust = await githubOidcService.createGithubOidcTrust({
        name: trimmedName,
        repository: repo,
        allowedRefs,
        environment,
        scopes: resolved.scopes,
        allowedDomainIds: accessForm.domainIds,
        allowedCertIds: accessForm.certIds,
      });
      // With more than one policy for a repository, the action has to say
      // which one to use.
      const shared = trusts.some((t) =>
        sameRepo(t.repository, trust.repository),
      );
      setSnippet({
        trust,
        text: workflowSnippet(shared ? trust.id : undefined),
      });
      toast.success(`Trust policy "${trimmedName}" created!`);
      resetForm();
      setTrusts((prev) => [...prev, trust]);
    } catch (error) {
      // The API client already shows the server's message.
      console.error('Failed to create GitHub trust policy:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (trust: GithubOidcTrust) => {
    if (
      !confirm(
        `Delete trust policy "${trust.name}"? Workflows in ${trust.repository} can no longer get keys through it. Keys it already issued last at most 15 minutes.`,
      )
    ) {
      return;
    }

    try {
      deletingIds.add(trust.id);
      await githubOidcService.deleteGithubOidcTrust(trust.id);
      toast.success(`Trust policy "${trust.name}" deleted.`);
      setTrusts((prev) => prev.filter((t) => t.id !== trust.id));
      setSnippet((prev) => (prev?.trust.id === trust.id ? null : prev));
    } catch (error) {
      console.error('Failed to delete GitHub trust policy:', error);
    } finally {
      deletingIds.remove(trust.id);
    }
  };

  return (
    <section aria-labelledby="github-oidc-heading" className="mt-10">
      <div className="flex items-center gap-3 mb-2">
        <Workflow className="w-5 h-5 text-zinc-400" />
        <h2
          id="github-oidc-heading"
          className="text-lg font-semibold text-zinc-100"
        >
          GitHub Actions (no stored key)
        </h2>
      </div>
      <p className="text-sm text-zinc-400 mb-6">
        Workflows in a trusted repository get a 15-minute key from their GitHub
        OIDC token, so no API key is stored as a secret.
      </p>

      <Card className="mb-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">
          Add Trust Policy
        </h3>
        <form
          onSubmit={handleCreate}
          aria-label="Add GitHub trust policy"
          className="space-y-5"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              id="github-oidc-name"
              label="Policy name"
              placeholder="e.g., website deploy"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={creating || atLimit}
              maxLength={100}
            />
            <Input
              id="github-oidc-repository"
              label="Repository"
              placeholder="owner/name"
              value={repository}
              onChange={(e) => {
                setRepository(e.target.value);
                setRepoError(null);
              }}
              disabled={creating || atLimit}
              error={repoError ?? undefined}
              aria-invalid={repoError ? true : undefined}
              className="font-mono"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Textarea
              id="github-oidc-refs"
              label="Branches or tags (optional)"
              placeholder={'refs/heads/main\nrefs/tags/v*'}
              rows={3}
              value={refsText}
              onChange={(e) => {
                setRefsText(e.target.value);
                setRefsError(null);
              }}
              disabled={creating || atLimit}
              error={refsError ?? undefined}
              aria-invalid={refsError ? true : undefined}
              helpText="One per line, starting with refs/. End with * to match a prefix. Leave empty to allow any branch or tag."
              className="font-mono"
            />
            <Input
              id="github-oidc-environment"
              label="Environment (optional)"
              placeholder="e.g., production"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              disabled={creating || atLimit}
              maxLength={255}
              helpText="Only jobs that run in this GitHub environment match."
            />
          </div>

          <AccessChoiceFields
            form={accessForm}
            idPrefix="github-oidc"
            disabled={creating || atLimit}
          />

          <RestrictionFields
            form={accessForm}
            idPrefix="github-oidc"
            disabled={creating || atLimit}
          />

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
            <p className="text-xs text-zinc-500 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {atLimit
                ? `You have the maximum of ${MAX_GITHUB_OIDC_TRUSTS} trust policies. Delete one to add another.`
                : "Policies can't be edited. To change one, add a new policy and delete the old one."}
            </p>
            <Button
              type="submit"
              variant="primary"
              disabled={creating || atLimit}
              icon={<Plus className="w-3.5 h-3.5" />}
              className="shrink-0"
            >
              {creating ? 'Adding...' : 'Add Trust Policy'}
            </Button>
          </div>
        </form>
      </Card>

      {snippet && (
        <Card className="mb-6 border-emerald-500/20 bg-emerald-500/5">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-emerald-400">
              Add this to a workflow in {snippet.trust.repository}:
            </p>
            <pre
              aria-label="Workflow snippet"
              className="bg-zinc-950 rounded-lg px-4 py-3 font-mono text-xs text-zinc-200 overflow-x-auto"
            >
              {snippet.text}
            </pre>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy className="w-3.5 h-3.5" />}
                onClick={() => copyToClipboard(snippet.text)}
              >
                Copy snippet
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSnippet(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-medium text-zinc-400 mb-4">
          Trust Policies ({trusts.length} of {MAX_GITHUB_OIDC_TRUSTS})
        </h3>

        {loading ? (
          <p className="text-zinc-400 text-sm">Loading trust policies...</p>
        ) : trusts.length === 0 ? (
          <EmptyState
            icon={<Workflow className="w-8 h-8" />}
            title="No trust policies yet"
            description="Add one above so a repository's workflows can get keys without a stored secret."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableHead>Name</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead>Branches and environment</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Actions</TableHead>
            </TableHeader>
            <tbody>
              {trusts.map((trust) => (
                <TableRow key={trust.id}>
                  <TableCell className="font-medium text-zinc-200">
                    {trust.name}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-zinc-200">
                      {trust.repository}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {trust.repositoryId
                        ? `pinned to repo id ${trust.repositoryId}`
                        : 'not used yet'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {trust.allowedRefs?.length ? (
                      <span className="block font-mono text-xs text-zinc-300">
                        {trust.allowedRefs.join(', ')}
                      </span>
                    ) : (
                      <span className="block text-xs text-zinc-500">
                        Any branch or tag
                      </span>
                    )}
                    {trust.environment && (
                      <span className="block text-xs text-zinc-500">
                        environment:{' '}
                        <span className="font-mono text-zinc-300">
                          {trust.environment}
                        </span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <AccessSummary
                      scopes={trust.scopes}
                      allowedDomainIds={trust.allowedDomainIds}
                      allowedCertIds={trust.allowedCertIds}
                      domainNames={domainNames}
                    />
                  </TableCell>
                  <TableCell>
                    {trust.lastUsedAt ? (
                      <span title={new Date(trust.lastUsedAt).toLocaleString()}>
                        {new Date(trust.lastUsedAt).toLocaleDateString()}
                        {trust.lastUsedRef && (
                          <span className="block text-xs text-zinc-500 font-mono">
                            {trust.lastUsedRef}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-zinc-500">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Trash2 className="w-3.5 h-3.5" />}
                      onClick={() => handleDelete(trust)}
                      disabled={deletingIds.has(trust.id)}
                      aria-label={`Delete trust policy ${trust.name}`}
                    >
                      {deletingIds.has(trust.id) ? 'Deleting...' : 'Delete'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </section>
  );
}
