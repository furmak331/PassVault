import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { IconButton } from './Button';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Wider layout for content-heavy dialogs like Settings. */
  size?: 'md' | 'lg';
}

/**
 * Modal dialog. Radix handles focus trapping, Escape, scroll locking and the
 * ARIA wiring; this component only adds PassVaultify styling.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="pv-dialog__overlay" />
        <RadixDialog.Content
          className={`pv-dialog pv-dialog--${size}`}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="pv-dialog__head">
            <RadixDialog.Title className="pv-dialog__title">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton icon="close" label="Close" />
            </RadixDialog.Close>
          </div>
          {description && (
            <RadixDialog.Description className="pv-dialog__desc">
              {description}
            </RadixDialog.Description>
          )}
          <div className="pv-dialog__body">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
