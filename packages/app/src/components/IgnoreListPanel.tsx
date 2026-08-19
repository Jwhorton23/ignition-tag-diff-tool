import { useEffect, useState } from 'react';

interface IgnoreListPanelProps {
  open: boolean;
  currentKeys: readonly string[];
  pending: boolean;
  onApply: (keys: string[]) => void;
  onClose: () => void;
}

export function IgnoreListPanel({ open, currentKeys, pending, onApply, onClose }: IgnoreListPanelProps) {
  const [draft, setDraft] = useState<string[]>([...currentKeys]);
  const [newKey, setNewKey] = useState('');

  // Reset the draft to the live list whenever the panel is (re)opened.
  useEffect(() => {
    if (open) setDraft([...currentKeys]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function addKey() {
    const trimmed = newKey.trim();
    if (trimmed && !draft.includes(trimmed)) {
      setDraft([...draft, trimmed]);
    }
    setNewKey('');
  }

  function removeKey(key: string) {
    setDraft(draft.filter((k) => k !== key));
  }

  const dirty = draft.length !== currentKeys.length || draft.some((k) => !currentKeys.includes(k));

  return (
    <div className="ignore-list-panel">
      <div className="ignore-list-panel__header">
        <span>Ignored properties</span>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="ignore-list-panel__hint">
        Properties listed here never affect diff status or rollups — useful for noisy fields specific to your environment. Applying re-diffs both files.
      </p>
      <div className="ignore-list-panel__chips">
        {draft.map((key) => (
          <span key={key} className="ignore-chip">
            {key}
            <button type="button" onClick={() => removeKey(key)} aria-label={`Remove ${key}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="ignore-list-panel__add">
        <input
          type="text"
          placeholder="Property name…"
          value={newKey}
          onChange={(ev) => setNewKey(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') addKey();
          }}
        />
        <button type="button" onClick={addKey}>
          Add
        </button>
      </div>
      <div className="ignore-list-panel__actions">
        <button type="button" className="primary-button" disabled={!dirty || pending} onClick={() => onApply(draft)}>
          {pending ? 'Applying…' : 'Apply & re-diff'}
        </button>
        <button type="button" onClick={onClose} disabled={pending}>
          Close
        </button>
      </div>
    </div>
  );
}
