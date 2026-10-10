import { useEffect, useState } from 'react';
import axios from 'axios';
import { Plus } from 'lucide-react';
import { MAX_CONNECTORS_PER_USER } from '@krakenkey/shared';
import type {
  ConnectorScope,
  CreateConnectorResponse,
} from '@krakenkey/shared';
import { useAccessForm } from '../../hooks/useAccessForm';
import * as connectorService from '../../services/connectorService';
import { CertChecklist, DomainChecklist } from '../AccessFields';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

const legendClass = 'text-sm font-medium text-zinc-300 mb-2';

/** The message to show for a failed create, or null when a toast is enough. */
function createErrorMessage(error: unknown): string | null {
  if (axios.isAxiosError(error) && error.response?.status === 402) {
    return `You have the maximum of ${MAX_CONNECTORS_PER_USER} active connectors. Revoke one you no longer use to add another.`;
  }
  return null;
}

export function CreateConnectorModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: CreateConnectorResponse) => void;
}) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [clientLabel, setClientLabel] = useState('');
  const [renew, setRenew] = useState(true);
  const [restrictionError, setRestrictionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const accessForm = useAccessForm();
  const { loadDomains, loadCerts, domainIds, certIds } = accessForm;

  useEffect(() => {
    if (open) {
      void loadDomains();
      void loadCerts();
    }
  }, [open, loadDomains, loadCerts]);

  // Picking anything clears the "pick at least one" error.
  const shownRestrictionError =
    domainIds.length === 0 && certIds.length === 0 ? restrictionError : null;

  const reset = () => {
    setName('');
    setNameError(null);
    setClientLabel('');
    setRenew(true);
    setRestrictionError(null);
    setFormError(null);
    accessForm.reset();
  };

  const close = () => {
    if (creating) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Enter a name for the connector.');
      return;
    }
    if (domainIds.length === 0 && certIds.length === 0) {
      setRestrictionError(
        'Pick at least one certificate or domain. A connector can only use what it is limited to.',
      );
      return;
    }

    const scopes: ConnectorScope[] = renew
      ? ['certs:read', 'certs:renew']
      : ['certs:read'];
    try {
      setCreating(true);
      const result = await connectorService.createConnector({
        name: trimmed,
        clientLabel,
        scopes,
        allowedCertIds: certIds,
        allowedDomainIds: domainIds,
      });
      reset();
      onCreated(result);
    } catch (error) {
      // The API client already shows the server's message as a toast.
      console.error('Failed to create connector:', error);
      setFormError(createErrorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="New Connector" size="lg">
      <form
        onSubmit={handleSubmit}
        aria-label="Create connector"
        className="flex flex-col gap-5"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            id="connector-name"
            label="Name"
            placeholder="e.g., web-01"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            disabled={creating}
            maxLength={64}
            error={nameError ?? undefined}
            aria-invalid={nameError ? true : undefined}
          />
          <Input
            id="connector-client-label"
            label="Client label (optional)"
            placeholder="e.g., Acme Corp"
            value={clientLabel}
            onChange={(e) => setClientLabel(e.target.value)}
            disabled={creating}
            maxLength={64}
            helpText="The customer or site it runs for. Shown in alerts."
          />
        </div>

        <fieldset disabled={creating}>
          <legend className={legendClass}>Access</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            <label className="flex items-start gap-2 p-2 rounded-lg">
              <input
                type="checkbox"
                checked
                disabled
                className="accent-cyan-500 mt-0.5"
              />
              <span>
                <span className="block font-mono text-xs text-zinc-200">
                  certs:read
                </span>
                <span className="block text-xs text-zinc-500">
                  Look up the certificates it manages. Always included.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-zinc-800/30">
              <input
                type="checkbox"
                checked={renew}
                onChange={(e) => setRenew(e.target.checked)}
                className="accent-cyan-500 mt-0.5"
              />
              <span>
                <span className="block font-mono text-xs text-zinc-200">
                  certs:renew
                </span>
                <span className="block text-xs text-zinc-500">
                  Renew certificates with keys the connector creates, and issue
                  pending ones. Without it, the connector only deploys.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <div
          className="flex flex-col gap-4"
          aria-describedby={
            shownRestrictionError ? 'connector-restriction-error' : undefined
          }
        >
          <div>
            <p className={legendClass}>Restrictions</p>
            <p className="text-xs text-zinc-500">
              Pick certificates, domains, or both. A connector can only use the
              certificates you pick, and if you pick domains, only certificates
              whose names are all within them. Choose at least one.
            </p>
          </div>
          <CertChecklist
            form={accessForm}
            disabled={creating}
            legend="Certificates"
            help="Renewing keeps the same certificate, so the limit still applies."
          />
          <DomainChecklist
            form={accessForm}
            disabled={creating}
            legend="Domains"
            help="Certificates for these domains are covered, including ones created later, such as a pending certificate for this connector."
          />
          {shownRestrictionError && (
            <p
              id="connector-restriction-error"
              role="alert"
              className="text-xs text-red-400"
            >
              {shownRestrictionError}
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-sm text-red-400">
            {formError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            onClick={close}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={<Plus className="w-3.5 h-3.5" />}
            disabled={creating}
          >
            {creating ? 'Creating...' : 'Create Connector'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
