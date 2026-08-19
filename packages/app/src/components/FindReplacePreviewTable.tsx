import type { FindReplaceChange } from '@ignition-diff/engine';

interface FindReplacePreviewTableProps {
  changes: FindReplaceChange[];
  included: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onToggleAll: (include: boolean) => void;
}

/** The mandatory preview table (PLAN.md §5) — a find/replace never applies
 *  anything the user hasn't seen row-by-row first, and every row can be
 *  individually opted out. */
export function FindReplacePreviewTable({ changes, included, onToggle, onToggleAll }: FindReplacePreviewTableProps) {
  if (changes.length === 0) {
    return <div className="find-replace-preview__empty">No matches.</div>;
  }

  const allIncluded = changes.every((c) => included.has(c.path));

  return (
    <div className="find-replace-preview">
      <div className="find-replace-preview__header">
        <label>
          <input type="checkbox" checked={allIncluded} onChange={(ev) => onToggleAll(ev.target.checked)} />
          {changes.length} match{changes.length === 1 ? '' : 'es'}
        </label>
      </div>
      <div className="find-replace-preview__table">
        <div className="find-replace-preview__row find-replace-preview__row--header">
          <span />
          <span>Path</span>
          <span>Before → After</span>
        </div>
        {changes.map((change) => (
          <div key={change.path} className="find-replace-preview__row">
            <input type="checkbox" checked={included.has(change.path)} onChange={() => onToggle(change.path)} />
            <span className="find-replace-preview__path" title={change.path}>
              {change.path}
            </span>
            <span className="find-replace-preview__diff">
              <span className="find-replace-preview__before">{change.before}</span>
              {' → '}
              <span className="find-replace-preview__after">{change.after}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
