import { formatRelative } from '../../utils/connectors';

/** A "Label: value" line on the connector page. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <span className="text-zinc-500 shrink-0">{label}:</span>
      <span className="text-zinc-300 min-w-0">{children}</span>
    </div>
  );
}

/** A date with how long ago it was, or "Never". */
export function When({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-zinc-500">Never</span>;
  return (
    <span title={new Date(iso).toLocaleString()}>
      {new Date(iso).toLocaleDateString()} ({formatRelative(iso)})
    </span>
  );
}
