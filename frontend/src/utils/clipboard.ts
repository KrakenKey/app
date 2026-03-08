import { toast } from './toast';

export function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text);
  toast.success('Copied to clipboard!');
}
