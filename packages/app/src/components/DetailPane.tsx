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

function PropRow({ row }: { row: PropDiff }) {
  return (
    <div className={`prop-row prop-row--${row.status}${row.ignored ? ' prop-row--ignored' : ''}`}>
      <div className="prop-row__header">
        <span className="prop-row__key">{row.key}</span>
        {row.ignored && <span className="prop-row__ignored-badge">ignored</span>}
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
}

export function DetailPane({ node, fileAName, fileBName, rows, loading, resolution, onResolve }: DetailPaneProps) {
  if (!node) {
    return (
      <div className="detail-pane detail-pane--empty">
        <p>Select a tag to see what changed.</p>
      </div>
    );
  }

  const needsResolution = node.status === 'modified' || node.status === 'type-changed';

  return (
    <div className="detail-pane">
      <div className="detail-pane__header">
        <span className="detail-pane__path">{node.path}</span>
        <span className={`detail-pane__status detail-pane__status--${node.status}`}>{node.status}</span>
      </div>

      {node.udtImpact === 'def-changed' && (
        <div className="detail-pane__notice">This instance's UDT definition changed between A and B, even though this tag's own overrides are identical.</div>
      )}

      {needsResolution && (
        <div className="conflict-bar">
          <span>Conflict:</span>
          <button type="button" className={resolution === 'a' ? 'active' : ''} onClick={() => onResolve('a')}>
            Take A ({fileAName})
          </button>
          <button type="button" className={resolution === 'b' ? 'active' : ''} onClick={() => onResolve('b')}>
            Take B ({fileBName})
          </button>
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
            <PropRow key={row.key} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
