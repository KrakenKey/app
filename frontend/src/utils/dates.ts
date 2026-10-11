/** "Aug 28, 2025". */
export function shortDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Full local date and time, for a `title` tooltip. */
export function fullDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
