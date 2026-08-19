// File I/O for the load/export screens. Loading uses plain File objects
// (from an <input type="file"> or a drop event) so it works in every
// browser. Exporting prefers the File System Access API's native Save-As
// dialog (Chromium, served from localhost — a secure context; PLAN.md §1)
// and falls back to a plain download when it isn't available.

export interface LoadedFile {
  name: string;
  text: string;
}

export async function readFile(file: File): Promise<LoadedFile> {
  const text = await file.text();
  return { name: file.name, text };
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  }
}

export async function saveTextFile(text: string, suggestedName: string): Promise<{ saved: boolean; method: 'picker' | 'download' }> {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Ignition tag export', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return { saved: true, method: 'picker' };
    } catch (err) {
      // AbortError = user cancelled the dialog; treat as a no-op, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { saved: false, method: 'picker' };
      }
      // Any other failure (e.g. API present but blocked) — fall through to download.
    }
  }

  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return { saved: true, method: 'download' };
}
