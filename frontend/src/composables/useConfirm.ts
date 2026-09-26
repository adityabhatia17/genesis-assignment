import { reactive, readonly } from 'vue';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
}

const state = reactive<ConfirmState>({
  open: false,
  title: '',
  description: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  destructive: false,
});
let resolver: ((ok: boolean) => void) | null = null;

/** Promise-based confirmation rendered by the single <ConfirmDialog> in App.vue. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  resolver?.(false);
  Object.assign(state, {
    open: true,
    title: options.title,
    description: options.description ?? '',
    confirmLabel: options.confirmLabel ?? 'Confirm',
    cancelLabel: options.cancelLabel ?? 'Cancel',
    destructive: options.destructive ?? false,
  });
  return new Promise((resolve) => {
    resolver = resolve;
  });
}

export function settleConfirm(ok: boolean): void {
  state.open = false;
  const resolve = resolver;
  resolver = null;
  resolve?.(ok);
}

export function useConfirm() {
  return { state: readonly(state), confirm: confirmAction, settle: settleConfirm };
}
