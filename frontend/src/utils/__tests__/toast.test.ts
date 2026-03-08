import { toast } from '../toast';

describe('ToastManager', () => {
  afterEach(() => {
    // Clean up any toast containers from the DOM
    const container = document.getElementById('toast-container');
    if (container) container.remove();
    const styles = document.getElementById('toast-styles');
    if (styles) styles.remove();
    // Reset the singleton's internal container reference so it creates a new one
    (toast as unknown as { container: HTMLElement | null }).container = null;
  });

  it('creates a toast container on first toast', () => {
    expect(document.getElementById('toast-container')).toBeNull();
    toast.info('Test message');
    expect(document.getElementById('toast-container')).not.toBeNull();
  });

  it('shows toast with correct content', () => {
    toast.info('Hello World');
    const container = document.getElementById('toast-container');
    expect(container?.textContent).toContain('Hello World');
  });

  it('success() calls show with type success', () => {
    const spy = vi.spyOn(toast, 'show');
    toast.success('Success!');
    expect(spy).toHaveBeenCalledWith({
      message: 'Success!',
      type: 'success',
      duration: undefined,
    });
  });

  it('error() calls show with type error', () => {
    const spy = vi.spyOn(toast, 'show');
    toast.error('Error!');
    expect(spy).toHaveBeenCalledWith({
      message: 'Error!',
      type: 'error',
      duration: undefined,
    });
  });

  it('info() calls show with type info', () => {
    const spy = vi.spyOn(toast, 'show');
    toast.info('Info!');
    expect(spy).toHaveBeenCalledWith({
      message: 'Info!',
      type: 'info',
      duration: undefined,
    });
  });

  it('warning() calls show with type warning', () => {
    const spy = vi.spyOn(toast, 'show');
    toast.warning('Warning!');
    expect(spy).toHaveBeenCalledWith({
      message: 'Warning!',
      type: 'warning',
      duration: undefined,
    });
  });

  it('removes toast after specified duration', () => {
    vi.useFakeTimers();
    toast.info('Temporary', 1000);
    const container = document.getElementById('toast-container');
    expect(container?.children.length).toBe(1);

    // Advance past duration + slide-out animation
    vi.advanceTimersByTime(1300);
    expect(container?.children.length).toBe(0);
    vi.useRealTimers();
  });

  it('reuses existing container for multiple toasts', () => {
    toast.info('First');
    toast.info('Second');
    const containers = document.querySelectorAll('#toast-container');
    expect(containers.length).toBe(1);
    expect(containers[0].children.length).toBe(2);
  });
});
