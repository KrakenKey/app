import { useContext } from 'react';
import { ConfirmContext } from '../context/ConfirmContext';

/**
 * Ask the user to confirm an action in a dialog.
 *
 * ```ts
 * const confirm = useConfirm();
 * if (!(await confirm({ title: 'Delete domain?', confirmLabel: 'Delete domain' }))) return;
 * ```
 */
export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context;
};
