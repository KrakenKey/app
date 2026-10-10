import { useMemo } from 'react';
import { AlertTriangle, Copy } from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard';
import {
  CONNECTOR_CONFIG_PATH,
  CONNECTOR_DOCS_URL,
  dockerCommands,
  enrollCommand,
} from '../../utils/connectors';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

function Snippet({
  label,
  text,
  copyLabel,
}: {
  label: string;
  text: string;
  copyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-zinc-400">{label}</p>
      <pre
        aria-label={label}
        className="bg-zinc-950 rounded-lg px-4 py-3 font-mono text-xs text-zinc-200 overflow-x-auto"
      >
        {text}
      </pre>
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon={<Copy className="w-3.5 h-3.5" />}
          onClick={() => copyToClipboard(text)}
        >
          {copyLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * A connector's enrollment token, shown once right after it is created,
 * with the commands that use it.
 */
export function EnrollmentTokenPanel({
  connectorName,
  token,
  expiresAt,
  onDismiss,
}: {
  connectorName: string;
  token: string;
  /** When the token expires (ISO 8601), as the API returned it. */
  expiresAt: string;
  onDismiss: () => void;
}) {
  const expires = useMemo(() => new Date(expiresAt), [expiresAt]);
  const enroll = useMemo(() => enrollCommand(), []);
  const docker = useMemo(() => dockerCommands(), []);

  return (
    <Card
      className="mb-6 border-emerald-500/20 bg-emerald-500/5"
      aria-label="Enrollment token"
      role="region"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-emerald-400">
            Enrollment token for {connectorName}:
          </p>
          <code
            data-testid="enrollment-token"
            className="block bg-zinc-950 rounded-lg px-4 py-3 font-mono text-sm text-zinc-200 break-all"
          >
            {token}
          </code>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => copyToClipboard(token)}
            >
              Copy token
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
          <p className="text-xs text-amber-400 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Copy this token now. It will not be shown again. It works once and
              expires on {expires.toLocaleString()}. If it expires first, get a
              new one from the connector's page.
            </span>
          </p>
        </div>

        <div className="border-t border-emerald-500/10 pt-4 flex flex-col gap-4">
          <p className="text-sm text-zinc-300">
            Write the connector's config at{' '}
            <code className="font-mono text-xs text-zinc-200">
              {CONNECTOR_CONFIG_PATH}
            </code>{' '}
            with the certificates it manages and where it installs them (see the{' '}
            <a
              href={CONNECTOR_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:text-cyan-300 underline"
            >
              connector install guide
            </a>
            ), save the token to a file, then enroll it as the user it will run
            as:
          </p>
          <Snippet
            label="Enroll on the host"
            text={enroll}
            copyLabel="Copy commands"
          />
          <Snippet
            label="Enroll and run with Docker"
            text={docker}
            copyLabel="Copy Docker commands"
          />
          <p className="text-xs text-zinc-500">
            Set VERSION to the connector release you want to run and pin it, so
            an upgrade happens when you choose. Mount the directories the
            connector installs certificates into (here /srv/tls), and keep the
            data volume: it holds the connector's identity key.
          </p>
        </div>
      </div>
    </Card>
  );
}
