import { Button, Dialog, TextField } from '@passvaultify/ui';
import { useState } from 'react';

const CONFIRM_WORD = 'delete';

export interface DeleteVaultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultName: string;
  onDelete: () => Promise<void>;
  /** Shown above the confirmation, e.g. why there's no recovery. */
  intro?: string;
}

/** Erase the vault from this device. Typed confirmation, since it can't be undone. */
export function DeleteVaultDialog({
  open,
  onOpenChange,
  vaultName,
  onDelete,
  intro,
}: DeleteVaultDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const close = (next: boolean) => {
    if (!next) setTyped('');
    onOpenChange(next);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Delete ${vaultName}?`}
      description={
        intro ?? 'Every item in this vault will be erased from this device. This can’t be undone.'
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim().toLowerCase() !== CONFIRM_WORD) return;
          setBusy(true);
          void onDelete().finally(() => setBusy(false));
        }}
      >
        <TextField
          label={`Type “${CONFIRM_WORD}” to confirm`}
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <div className="dialog-actions">
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button
            variant="danger"
            type="submit"
            icon="trash"
            disabled={busy || typed.trim().toLowerCase() !== CONFIRM_WORD}
          >
            Delete vault
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
