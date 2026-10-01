export type StorageMode = 'local' | 'self' | 'cloud';

export interface DataChipProps {
  mode: StorageMode;
  /** Server host name for self-hosted mode, or the cloud region. */
  where?: string;
}

export function dataChipText({ mode, where }: DataChipProps): string {
  switch (mode) {
    case 'local':
      return 'Local only · this device';
    case 'self':
      return `Self-hosted · ${where ?? 'your server'}`;
    case 'cloud':
      return `PassVaultify Cloud · ${where ?? 'eu-1'}`;
  }
}

/** Always-visible label for where the vault lives. */
export function DataChip(props: DataChipProps) {
  const text = dataChipText(props);
  return (
    <span className="pv-chip" data-mode={props.mode} title={text}>
      <span className="pv-chip__dot" aria-hidden="true" />
      <span className="pv-chip__text">{text}</span>
    </span>
  );
}
