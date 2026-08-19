import { useRef, useState, type DragEvent } from 'react';
import { readFile, type LoadedFile } from '../lib/fileAccess';

interface DropZoneProps {
  label: string;
  file: LoadedFile | null;
  onFile: (file: LoadedFile) => void;
}

function DropZone({ label, file, onFile }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    const first = files?.[0];
    if (!first) return;
    onFile(await readFile(first));
  }

  function handleDrop(ev: DragEvent<HTMLDivElement>) {
    ev.preventDefault();
    setDragOver(false);
    void handleFiles(ev.dataTransfer.files);
  }

  return (
    <div
      className={`drop-zone${dragOver ? ' drop-zone--active' : ''}${file ? ' drop-zone--filled' : ''}`}
      onDragOver={(ev) => {
        ev.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(ev) => void handleFiles(ev.target.files)}
      />
      <div className="drop-zone__label">{label}</div>
      {file ? (
        <div className="drop-zone__filename">{file.name}</div>
      ) : (
        <div className="drop-zone__hint">Drop a tag export .json here, or click to browse</div>
      )}
    </div>
  );
}

interface LoadScreenProps {
  onReady: (fileA: LoadedFile, fileB: LoadedFile) => void;
  error?: string;
}

export function LoadScreen({ onReady, error }: LoadScreenProps) {
  const [fileA, setFileA] = useState<LoadedFile | null>(null);
  const [fileB, setFileB] = useState<LoadedFile | null>(null);

  return (
    <div className="load-screen">
      <h1>Ignition Tag Diff &amp; Merge Tool</h1>
      <p className="load-screen__subtitle">Load two tag exports to compare.</p>
      <div className="load-screen__zones">
        <DropZone label="File A" file={fileA} onFile={setFileA} />
        <button
          className="swap-button"
          type="button"
          aria-label="Swap A and B"
          disabled={!fileA && !fileB}
          onClick={() => {
            setFileA(fileB);
            setFileB(fileA);
          }}
        >
          ⇄
        </button>
        <DropZone label="File B" file={fileB} onFile={setFileB} />
      </div>
      {error && <div className="load-screen__error">{error}</div>}
      <button
        className="primary-button"
        type="button"
        disabled={!fileA || !fileB}
        onClick={() => fileA && fileB && onReady(fileA, fileB)}
      >
        Compare
      </button>
    </div>
  );
}
