import type { AccessForm } from '../../hooks/useAccessForm';
import { RestrictionPicker } from './RestrictionPicker';

const legendClass = 'text-sm font-medium text-text-secondary mb-2';
const scopeCardClass = 'flex items-start gap-3 rounded-lg border p-3';
const checkboxClass =
  'mt-0.5 h-4 w-4 shrink-0 rounded accent-cyan-500 disabled:opacity-60';

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
  const helpId = `${idPrefix}-restriction-help`;
  return (
    <>
      <fieldset disabled={disabled}>
        <legend className={legendClass}>Access</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={`${scopeCardClass} border-border-subtle`}>
            <input type="checkbox" checked disabled className={checkboxClass} />
            <span>
              <span className="block font-mono text-xs text-text">
                certs:read
              </span>
              <span className="mt-0.5 block text-xs text-text-muted">
                Look up the certificates it manages. Always included.
              </span>
            </span>
          </label>
          <label
            className={`${scopeCardClass} cursor-pointer ${
              renew
                ? 'border-accent/40 bg-accent/[0.05]'
                : 'border-border hover:border-border-strong hover:bg-white/[0.02]'
            }`}
          >
            <input
              type="checkbox"
              checked={renew}
              onChange={(e) => onRenewChange(e.target.checked)}
              className={checkboxClass}
            />
            <span>
              <span className="block font-mono text-xs text-text">
                certs:renew
              </span>
              <span className="mt-0.5 block text-xs text-text-muted">
                Renew certificates with keys the connector creates, and issue
                pending ones. Without it, the connector only deploys.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col gap-3">
        <div>
          <p className={legendClass}>Restrictions</p>
          <p id={helpId} className="text-xs text-text-muted">
            Pick certificates, domains, or both. A connector can only use the
            certificates you pick, and if you pick domains, only certificates
            whose names are all within them, including ones created later.
            Choose at least one. Renewing keeps the same certificate, so a
            certificate limit still applies.
          </p>
        </div>
        <RestrictionPicker
          form={form}
          disabled={disabled}
          describedBy={error ? `${helpId} ${errorId}` : helpId}
        />
        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
