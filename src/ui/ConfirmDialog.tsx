import { AlertTriangle } from 'lucide-react';
import { AlertDialog } from 'radix-ui';
import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
  description: ReactNode;
  onConfirm(): void;
  onOpenChange(open: boolean): void;
  open: boolean;
  title: string;
  tone?: 'danger' | 'default';
}

/** Small Radix-backed confirmation dialog for destructive editor/project flows. */
export function ConfirmDialog({
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
  tone = 'default',
}: ConfirmDialogProps) {
  const danger = tone === 'danger';
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[100] bg-black/35 backdrop-blur-[1px]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[101] flex w-[min(calc(100vw-2rem),24rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-xl">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                danger ? 'bg-destructive/15 text-destructive' : 'bg-accent text-accent-foreground'
              }`}
            >
              <AlertTriangle size={17} />
            </span>
            <div className="min-w-0">
              <AlertDialog.Title className="text-sm font-semibold text-foreground">
                {title}
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </AlertDialog.Description>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent">
              {cancelLabel}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={onConfirm}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                danger
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
            >
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
