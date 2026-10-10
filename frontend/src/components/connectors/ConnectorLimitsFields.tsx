import type { AccessForm } from '../../hooks/useAccessForm';
import { CertChecklist, DomainChecklist } from '../AccessFields';

const legendClass = 'text-sm font-medium text-zinc-300 mb-2';

/**
 * A connector's scopes (certs:read always, certs:renew optional) and its
 * certificate and domain restrictions, for creating or editing one.
 */
export function ConnectorLimitsFields({
  form,
  idPrefix,
  renew,
  onRenewChange,
  disabled,
  error,
}: {
  form: AccessForm;
  idPrefix: string;
  renew: boolean;
  onRenewChange: (renew: boolean) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const errorId = `${idPrefix}-restriction-error`;
  return (
    <>
      <fieldset disabled={disabled}>
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
              onChange={(e) => onRenewChange(e.target.checked)}
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
        aria-describedby={error ? errorId : undefined}
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
          form={form}
          disabled={disabled}
          legend="Certificates"
          help="Renewing keeps the same certificate, so the limit still applies."
        />
        <DomainChecklist
          form={form}
          disabled={disabled}
          legend="Domains"
          help="Certificates for these domains are covered, including ones created later."
        />
        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
