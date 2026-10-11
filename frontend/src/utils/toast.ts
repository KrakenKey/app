/**
 * Simple toast notification system for user feedback
 * No external dependencies needed for MVP
 *
 * Styled with the dashboard theme: a dark surface card with a colored
 * status rail, so toasts read as part of the app rather than as alerts
 * from the browser.
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
}

const TOAST_COLORS: Record<ToastType, string> = {
  success: '#34d399',
  error: '#f87171',
  info: '#a78bfa',
  warning: '#fbbf24',
};

const TOAST_LABELS: Record<ToastType, string> = {
  success: 'Done',
  error: 'Error',
  info: 'Note',
  warning: 'Warning',
};

class ToastManager {
  private container: HTMLDivElement | null = null;

  private ensureContainer() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.setAttribute('aria-live', 'polite');
      this.container.style.cssText = `
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      `;
      document.body.appendChild(this.container);
    }
    return this.container;
  }

  show({ message, type = 'info', duration = 4000 }: ToastOptions) {
    const container = this.ensureContainer();
    const color = this.getColor(type);

    const toast = document.createElement('div');
    toast.style.cssText = `
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: #1e293b;
      color: #f1f5f9;
      border: 1px solid #3b4b66;
      border-left: 3px solid ${color};
      padding: 11px 14px 11px 12px;
      border-radius: 10px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.03), 0 12px 32px -8px rgba(2, 6, 23, 0.75);
      max-width: 380px;
      min-width: 240px;
      word-wrap: break-word;
      pointer-events: auto;
      animation: kkToastIn 0.22s ease-out;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 13px;
      line-height: 1.45;
    `;

    const label = document.createElement('span');
    label.textContent = TOAST_LABELS[type];
    label.style.cssText = `
      flex-shrink: 0;
      font-weight: 600;
      color: ${color};
    `;
    const text = document.createElement('span');
    text.textContent = message;
    text.style.cssText = 'color: #cbd5e1;';
    toast.append(label, text);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes kkToastIn {
        from { transform: translateY(-6px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes kkToastOut {
        from { opacity: 1; }
        to { opacity: 0; transform: translateY(-4px); }
      }
    `;
    if (!document.getElementById('toast-styles')) {
      style.id = 'toast-styles';
      document.head.appendChild(style);
    }

    container.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
      toast.style.animation = 'kkToastOut 0.2s ease-in forwards';
      setTimeout(() => {
        if (toast.parentNode === container) container.removeChild(toast);
      }, 200);
    }, duration);
  }

  private getColor(type: ToastType): string {
    return TOAST_COLORS[type];
  }

  success(message: string, duration?: number) {
    this.show({ message, type: 'success', duration });
  }

  error(message: string, duration?: number) {
    this.show({ message, type: 'error', duration });
  }

  info(message: string, duration?: number) {
    this.show({ message, type: 'info', duration });
  }

  warning(message: string, duration?: number) {
    this.show({ message, type: 'warning', duration });
  }
}

export const toast = new ToastManager();
