/** Largest file the import dialog will read. Real exports are far smaller. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/** Save text as a file the browser downloads. Nothing leaves the device. */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the download a moment to start before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function readTextFile(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(
      'That file is larger than 25 MB, which is far bigger than any password export.',
    );
  }
  return file.text();
}

export function backupFilename(date = new Date()): string {
  return `passvaultify-backup-${date.toISOString().slice(0, 10)}.json`;
}

/** A CSV or a backup? Decided by content, since file names can't be trusted. */
export function looksLikeBackup(text: string): boolean {
  return text.trimStart().startsWith('{');
}

export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** "⌘K" on Apple devices, "Ctrl K" elsewhere. */
export const modKey = () => (isMac() ? '⌘' : 'Ctrl');
