import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import type { Connector, ConnectorScope } from '@krakenkey/shared';
import { useAccessForm } from '../../hooks/useAccessForm';
import * as connectorService from '../../services/connectorService';
import { RESTRICTION_REQUIRED } from '../../utils/connectors';
import { toast } from '../../utils/toast';
import { ConnectorLimitsFields } from './ConnectorLimitsFields';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

/**
 * Changes a connector's scopes and restrictions. Mount it only while open:
 * it starts from the connector's current limits.
 */
export function EditLimitsModal({
  connector,
  onClose,
  onSaved,
}: {
  connector: Connector;
  onClose: () => void;
  onSaved: (updated: Connector) => void;
}) {
  const [renew, setRenew] = useState(() =>
    connector.scopes.includes('certs:renew'),
  );
  const [restrictionError, setRestrictionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const accessForm = useAccessForm({
    domainIds: connector.allowedDomainIds ?? [],
    certIds: connector.allowedCertIds ?? [],
  });
  const { loadDomains, loadCerts, domainIds, certIds } = accessForm;

  useEffect(() => {
    void loadDomains();
    void loadCerts();
  }, [loadDomains, loadCerts]);

  const shownRestrictionError =
    domainIds.length === 0 && certIds.length === 0 ? restrictionError : null;

  const close = () => {
    if (!saving) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (domainIds.length === 0 && certIds.length === 0) {
      setRestrictionError(RESTRICTION_REQUIRED);
      return;
    }
    const scopes: ConnectorScope[] = renew
      ? ['certs:read', 'certs:renew']
      : ['certs:read'];
    try {
      setSaving(true);
      const updated = await connectorService.updateConnector(connector.id, {
        scopes,
        allowedCertIds: certIds.length ? certIds : null,
        allowedDomainIds: domainIds.length ? domainIds : null,
      });
      toast.success(
        'Limits saved. The connector gets keys with the new limits at its next check.',
      );
      onSaved(updated);
    } catch (error) {
      // The API client already shows the server's message as a toast.
      console.error('Failed to update connector limits:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title="Edit Access and Restrictions"
      size="lg"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={close}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-connector-limits-form"
            variant="primary"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        id="edit-connector-limits-form"
        onSubmit={handleSubmit}
        aria-label="Edit connector limits"
        className="flex flex-col gap-5"
      >
        <ConnectorLimitsFields
          form={accessForm}
          idPrefix="connector-edit"
          renew={renew}
          onRenewChange={setRenew}
          disabled={saving}
          error={shownRestrictionError}
        />

        <p className="text-xs text-zinc-500 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Saving revokes the connector's current short-lived keys, so the new
          limits apply from its next check.
        </p>
      </form>
    </Modal>
  );
}
