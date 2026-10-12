import { useState, useEffect, useCallback } from 'react';
import { Workflow, Plus, Trash2, Copy, Info, X } from 'lucide-react';
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
import { useConfirm } from '../hooks/useConfirm';
import { useAccessForm } from '../hooks/useAccessForm';
import * as githubOidcService from '../services/githubOidcService';
import {
  AccessChoiceFields,
  AccessSummary,
  RestrictionFields,
} from './AccessFields';
import { Card, CardHeader } from './ui/Card';
import { Modal } from './ui/Modal';
import { RowMenu } from './ui/Menu';
import { fullDateTime } from '../utils/dates';
import { formatRelative } from '../utils/connectors';
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
  const [addOpen, setAddOpen] = useState(false);
  const deletingIds = useActionSet<string>();
  const confirm = useConfirm();

  const [name, setName] = useState('');
  const [repository, setRepository] = useState('');
  const [repoError, setRepoError] = useState<string | null>(null);
  const [refsText, setRefsText] = useState('');
  const [refsError, setRefsError] = useState<string | null>(null);
  const [environment, setEnvironment] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [repoIdError, setRepoIdError] = useState<string | null>(null);
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

  // The dialog would otherwise focus its close button.
  useEffect(() => {
    if (addOpen) document.getElementById('github-oidc-name')?.focus();
  }, [addOpen]);

  const atLimit = trusts.length >= MAX_GITHUB_OIDC_TRUSTS;

  const resetForm = () => {
    setName('');
    setRepository('');
    setRepoError(null);
    setRefsText('');
    setRefsError(null);
    setEnvironment('');
    setRepositoryId('');
    setRepoIdError(null);
    accessForm.reset();
  };

  const closeAdd = () => {
    setAddOpen(false);
    resetForm();
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

    const repoId = repositoryId.trim();
    if (repoId && !/^[1-9][0-9]{0,19}$/.test(repoId)) {
      setRepoIdError('The repository ID is a number, e.g. 123456789.');
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
        repositoryId: repoId,
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
      if (!trust.repositoryId) {
        toast.info(
          `${trust.repository} isn't visible on GitHub without signing in (private, or misspelled), so the policy pins to it on its first workflow run. Check the spelling, or add the repository ID to pin it now.`,
        );
      }
      resetForm();
      setAddOpen(false);
      setTrusts((prev) => [...prev, trust]);
    } catch (error) {
      // The API client already shows the server's message.
      console.error('Failed to create GitHub trust policy:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (trust: GithubOidcTrust) => {
    const ok = await confirm({
      title: 'Delete trust policy?',
      body: (
        <>
          Workflows in <strong className="text-text">{trust.repository}</strong>{' '}
          can no longer get keys through{' '}
          <strong className="text-text">{trust.name}</strong>. Keys it already
          issued last at most 15 minutes.
        </>
      ),
      confirmLabel: 'Delete policy',
    });
    if (!ok) return;

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

  const limitNote = `You have the maximum of ${MAX_GITHUB_OIDC_TRUSTS} trust policies. Delete one to add another.`;

  return (
    <section aria-labelledby="github-oidc-heading" className="mt-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-4">
        <div className="min-w-0">
          <h2
            id="github-oidc-heading"
            className="text-base font-semibold tracking-tight text-text"
          >
            GitHub Actions (no stored key)
          </h2>
          <p className="text-sm text-text-muted mt-1 max-w-2xl">
            Workflows in a trusted repository get a 15-minute key from their
            GitHub OIDC token, so no API key is stored as a secret.
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setAddOpen(true)}
          disabled={atLimit}
          title={atLimit ? limitNote : undefined}
          className="shrink-0 self-start sm:self-auto"
        >
          Add trust policy
        </Button>
      </div>

      <Modal
        open={addOpen}
        onClose={closeAdd}
        title="Add trust policy"
        description="Lets workflows in one repository exchange their GitHub OIDC token for a short-lived key."
        size="xl"
        footer={
          <>
            <Button type="button" onClick={closeAdd} disabled={creating}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="add-github-trust-form"
              variant="primary"
              disabled={creating || atLimit}
            >
              {creating ? 'Adding...' : 'Add policy'}
            </Button>
          </>
        }
      >
        <form
          id="add-github-trust-form"
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
              autoComplete="off"
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
              autoComplete="off"
              spellCheck={false}
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

          <Input
            id="github-oidc-repository-id"
            label="Repository ID (optional)"
            placeholder="e.g., 123456789"
            value={repositoryId}
            onChange={(e) => {
              setRepositoryId(e.target.value);
              setRepoIdError(null);
            }}
            disabled={creating || atLimit}
            error={repoIdError ?? undefined}
            aria-invalid={repoIdError ? true : undefined}
            inputMode="numeric"
            maxLength={20}
            helpText="Pins the policy to this exact repository before its first run. Public repositories are pinned automatically. For a private one, run: gh api repos/OWNER/NAME --jq .id"
            className="font-mono"
          />

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

          <p className="text-xs text-text-muted flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {atLimit
              ? limitNote
              : "Policies can't be edited. To change one, add a new policy and delete the old one."}
          </p>
        </form>
      </Modal>

      {snippet && (
        <Card
          role="status"
          aria-label="New trust policy"
          className="mb-6 border-emerald-400/25 bg-emerald-400/[0.04]"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-text">
              Add this to a workflow in{' '}
              <span className="font-mono">{snippet.trust.repository}</span>:
            </p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setSnippet(null)}
              className="text-text-muted hover:text-text p-1 -mr-1 -mt-1 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <pre
            aria-label="Workflow snippet"
            className="mt-3 rounded-lg border border-border-subtle bg-bg px-3.5 py-3 font-mono text-xs text-text overflow-x-auto"
          >
            {snippet.text}
          </pre>
          <div className="mt-3">
            <Button
              variant="secondary"
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => copyToClipboard(snippet.text)}
            >
              Copy snippet
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-text-muted">Loading trust policies...</p>
      ) : trusts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Workflow className="w-6 h-6" />}
            title="No trust policies yet"
            description="Add one so a repository's workflows can get keys without a stored secret."
          />
        </Card>
      ) : (
        <Card flush>
          <CardHeader
            title={`Trust Policies (${trusts.length} of ${MAX_GITHUB_OIDC_TRUSTS})`}
            description={atLimit ? limitNote : undefined}
          />
          <Table className="sm:min-w-[760px]">
            <TableHeader>
              <TableHead className="pl-5">Name</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead className="hidden md:table-cell">
                Branches and environment
              </TableHead>
              <TableHead className="hidden md:table-cell">Access</TableHead>
              <TableHead className="hidden sm:table-cell">Last used</TableHead>
              <TableHead className="text-right pr-5">Actions</TableHead>
            </TableHeader>
            <tbody>
              {trusts.map((trust) => {
                const deleting = deletingIds.has(trust.id);
                return (
                  <TableRow key={trust.id}>
                    <TableCell className="pl-5 font-medium text-text">
                      {trust.name}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-text">
                        {trust.repository}
                      </span>
                      <span className="block text-xs text-text-muted">
                        {trust.repositoryId
                          ? `pinned to repo id ${trust.repositoryId}`
                          : 'pins on its first run'}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {trust.allowedRefs?.length ? (
                        <span className="block font-mono text-xs text-text-secondary">
                          {trust.allowedRefs.join(', ')}
                        </span>
                      ) : (
                        <span className="block text-xs text-text-muted">
                          Any branch or tag
                        </span>
                      )}
                      {trust.environment && (
                        <span className="block text-xs text-text-muted">
                          environment:{' '}
                          <span className="font-mono text-text-secondary">
                            {trust.environment}
                          </span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <AccessSummary
                        scopes={trust.scopes}
                        allowedDomainIds={trust.allowedDomainIds}
                        allowedCertIds={trust.allowedCertIds}
                        domainNames={domainNames}
                      />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap">
                      {trust.lastUsedAt ? (
                        <span title={fullDateTime(trust.lastUsedAt)}>
                          {formatRelative(trust.lastUsedAt)}
                          {trust.lastUsedRef && (
                            <span className="block text-xs text-text-muted font-mono">
                              {trust.lastUsedRef}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-text-muted">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-5">
                      <div className="flex justify-end">
                        <RowMenu
                          label={`More actions for ${trust.name}`}
                          items={[
                            {
                              label: deleting ? 'Deleting...' : 'Delete',
                              icon: <Trash2 className="w-3.5 h-3.5" />,
                              danger: true,
                              disabled: deleting,
                              onClick: () => handleDelete(trust),
                            },
                          ]}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </section>
  );
}
