import { diffLines, type DiffNode, type JsonValue, type MergeSide, type PropDiff } from '@ignition-diff/engine';

function formatValue(v: JsonValue | undefined): string {
  if (v === undefined) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function ScriptDiff({ before, after }: { before: string; after: string }) {
  const ops = diffLines(before, after);
  return (
    <pre className="script-diff">
      {ops.map((op, i) => (
        <div key={i} className={`script-diff__line script-diff__line--${op.type}`}>
          <span className="script-diff__marker">{op.type === 'add' ? '+' : op.type === 'remove' ? '-' : ' '}</span>
          {op.line}
        </div>
      ))}
    </pre>
  );
}

interface PropRowProps {
  row: PropDiff;
  cherryPickable: boolean;
  cherryPickedSide: MergeSide | undefined;
  onCherryPick: (key: string, side: MergeSide) => void;
}

function PropRow({ row, cherryPickable, cherryPickedSide, onCherryPick }: PropRowProps) {
  return (
    <div className={`prop-row prop-row--${row.status}${row.ignored ? ' prop-row--ignored' : ''}`}>
      <div className="prop-row__header">
        <span className="prop-row__key">{row.key}</span>
        {row.ignored && <span className="prop-row__ignored-badge">ignored</span>}
        {cherryPickable && (
          <span className="prop-row__cherry-pick" title="Cherry-pick this property">
            <button type="button" className={cherryPickedSide === 'a' ? 'active' : ''} onClick={() => onCherryPick(row.key, 'a')}>
              A
            </button>
            <button type="button" className={cherryPickedSide === 'b' ? 'active' : ''} onClick={() => onCherryPick(row.key, 'b')}>
              B
            </button>
          </span>
        )}
      </div>
      {row.renderHint === 'script' ? (
        <ScriptDiff before={typeof row.aValue === 'string' ? row.aValue : ''} after={typeof row.bValue === 'string' ? row.bValue : ''} />
      ) : (
        <div className="prop-row__values">
          <div className="prop-row__value prop-row__value--a">{formatValue(row.aValue)}</div>
          <div className="prop-row__value prop-row__value--b">{formatValue(row.bValue)}</div>
        </div>
      )}
    </div>
  );
}

interface DetailPaneProps {
  node: DiffNode | undefined;
  fileAName: string;
  fileBName: string;
  rows: PropDiff[] | undefined;
  loading: boolean;
  resolution: MergeSide | undefined;
  onResolve: (side: MergeSide) => void;
  cherryPicks: ReadonlyMap<string, MergeSide> | undefined;
  onCherryPick: (propKey: string, side: MergeSide) => void;
  forceIncludable: boolean;
  wholeSubtreeSelected: boolean;
  onToggleWholeSubtree: () => void;
}

export function DetailPane({
  node,
  fileAName,
  fileBName,
  rows,
  loading,
  resolution,
  onResolve,
  cherryPicks,
  onCherryPick,
  forceIncludable,
  wholeSubtreeSelected,
  onToggleWholeSubtree,
}: DetailPaneProps) {
  if (!node) {
    return (
      <div className="detail-pane detail-pane--empty">
        <p>Select a tag to see what changed.</p>
      </div>
    );
  }

  const needsResolution = node.status === 'modified' || node.status === 'type-changed';
  const cherryPickActive = !!cherryPicks?.size;

  return (
    <div className="detail-pane">
      <div className="detail-pane__header">
        <span className="detail-pane__path">{node.path}</span>
        <span className={`detail-pane__status detail-pane__status--${node.status}`}>{node.status}</span>
      </div>

      {node.udtImpact === 'def-changed' && (
        <div className="detail-pane__notice">This instance's UDT definition changed between A and B, even though this tag's own overrides are identical.</div>
      )}

      {forceIncludable && (
        <div className="detail-pane__notice detail-pane__notice--force-include">
          <span>
            {node.status === 'unchanged'
              ? "This tag (or some tags below it) is identical in both files, so the checkbox can't reach it — nothing to change for a same-environment merge."
              : 'Some tags below this one are identical in both files and are skipped by the normal checkbox.'}{' '}
            Building a standalone export for a gateway that doesn't have this at all yet? Force-include the whole subtree, unchanged tags included.
          </span>
          <button type="button" className={wholeSubtreeSelected ? 'active' : ''} onClick={onToggleWholeSubtree}>
            {wholeSubtreeSelected ? '✓ Whole subtree included' : 'Include entire subtree'}
          </button>
        </div>
      )}

      {needsResolution && (
        <div className="conflict-bar">
          <span>Conflict:</span>
          <button type="button" className={!cherryPickActive && resolution === 'a' ? 'active' : ''} onClick={() => onResolve('a')}>
            Take A ({fileAName})
          </button>
          <button type="button" className={!cherryPickActive && resolution === 'b' ? 'active' : ''} onClick={() => onResolve('b')}>
            Take B ({fileBName})
          </button>
          {cherryPickActive && <span className="conflict-bar__cherry-pick-notice">cherry-picked ({cherryPicks!.size} propert{cherryPicks!.size === 1 ? 'y' : 'ies'})</span>}
        </div>
      )}

      {loading && <div className="detail-pane__loading">Loading…</div>}

      {!loading && rows && rows.length === 0 && <div className="detail-pane__empty">No property differences (only child tags differ).</div>}

      {!loading && rows && rows.length > 0 && (
        <div className="prop-table">
          <div className="prop-table__columns">
            <span />
            <span>A — {fileAName}</span>
            <span>B — {fileBName}</span>
          </div>
          {rows.map((row) => (
            <PropRow
              key={row.key}
              row={row}
              cherryPickable={needsResolution}
              cherryPickedSide={cherryPicks?.get(row.key)}
              onCherryPick={onCherryPick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
