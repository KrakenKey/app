/**
 * Simple toast notification system for user feedback
 * No external dependencies needed for MVP
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
}

class ToastManager {
  private container: HTMLDivElement | null = null;

  private ensureContainer() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(this.container);
    }
    return this.container;
  }

  show({ message, type = 'info', duration = 4000 }: ToastOptions) {
    const container = this.ensureContainer();

    const toast = document.createElement('div');
    toast.style.cssText = `
      background: ${this.getColor(type)};
      color: white;
      padding: 12px 20px;
      border-radius: 6px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      max-width: 400px;
      word-wrap: break-word;
      pointer-events: auto;
      animation: slideIn 0.3s ease-out;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
    `;
    toast.textContent = message;

    // Add slide-in animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }
    `;
    if (!document.getElementById('toast-styles')) {
      style.id = 'toast-styles';
      document.head.appendChild(style);
    }

    container.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => {
        container.removeChild(toast);
      }, 300);
    }, duration);
  }

  private getColor(type: ToastType): string {
    const colors = {
      success: '#10b981',
      error: '#ef4444',
      info: '#3b82f6',
      warning: '#f59e0b',
    };
    return colors[type];
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
