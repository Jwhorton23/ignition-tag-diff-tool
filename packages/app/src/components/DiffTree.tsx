import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DiffIndex, DiffStatus } from '@ignition-diff/engine';
import { checkboxState, flattenTree, type TreeRow } from '../lib/treeHelpers';

const STATUS_GLYPH: Record<DiffStatus, string> = {
  added: '⊕',
  removed: '⊖',
  modified: '⬤',
  'type-changed': '⬤',
  unchanged: '',
};

interface DiffTreeProps {
  diffIndex: DiffIndex;
  expanded: ReadonlySet<string>;
  onToggleExpand: (path: string) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (path: string) => void;
  openPath: string | undefined;
  onOpen: (path: string) => void;
}

export function DiffTree({ diffIndex, expanded, onToggleExpand, selected, onToggleSelect, openPath, onOpen }: DiffTreeProps) {
  const rows = useMemo(() => flattenTree(diffIndex, expanded), [diffIndex, expanded]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 20,
  });

  return (
    <div className="diff-tree" ref={scrollRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <TreeRowView
              key={row.path}
              row={row}
              diffIndex={diffIndex}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              selected={selected}
              onToggleSelect={onToggleSelect}
              isOpen={row.path === openPath}
              onOpen={onOpen}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

interface TreeRowViewProps {
  row: TreeRow;
  diffIndex: DiffIndex;
  expanded: ReadonlySet<string>;
  onToggleExpand: (path: string) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (path: string) => void;
  isOpen: boolean;
  onOpen: (path: string) => void;
  style: React.CSSProperties;
}

function TreeRowView({ row, diffIndex, expanded, onToggleExpand, selected, onToggleSelect, isOpen, onOpen, style }: TreeRowViewProps) {
  const node = diffIndex.byPath.get(row.path);
  if (!node) return null;

  const state = checkboxState(diffIndex, selected, row.path);
  const showCheckbox = state !== 'unchecked' || node.status !== 'unchanged' || node.rollup.added + node.rollup.removed + node.rollup.modified > 0;
  const hasRollup = node.rollup.added + node.rollup.removed + node.rollup.modified + node.rollup.inherited > 0;

  return (
    <div
      className={`tree-row${isOpen ? ' tree-row--open' : ''} tree-row--${node.status}`}
      style={{ ...style, paddingLeft: `${row.depth * 18 + 4}px` }}
      onClick={() => onOpen(row.path)}
    >
      {row.hasChildren ? (
        <button
          className="tree-row__chevron"
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleExpand(row.path);
          }}
          aria-label={expanded.has(row.path) ? 'Collapse' : 'Expand'}
        >
          {expanded.has(row.path) ? '▾' : '▸'}
        </button>
      ) : (
        <span className="tree-row__chevron-spacer" />
      )}

      {showCheckbox ? (
        <input
          type="checkbox"
          checked={state === 'checked'}
          ref={(el) => {
            if (el) el.indeterminate = state === 'indeterminate';
          }}
          onClick={(ev) => ev.stopPropagation()}
          onChange={() => onToggleSelect(row.path)}
        />
      ) : (
        <span className="tree-row__checkbox-spacer" />
      )}

      <span className={`tree-row__glyph tree-row__glyph--${node.status}`}>{STATUS_GLYPH[node.status]}</span>
      <span className="tree-row__name">{node.name}</span>
      {node.caseOnlyRename && <span className="tree-row__badge tree-row__badge--rename">rename</span>}
      {node.udtImpact === 'def-changed' && <span className="tree-row__badge tree-row__badge--inherited">inherited</span>}

      {hasRollup && (
        <span className="tree-row__rollup">
          {node.rollup.added > 0 && <span className="rollup rollup--added">{node.rollup.added}+</span>}
          {node.rollup.removed > 0 && <span className="rollup rollup--removed">{node.rollup.removed}−</span>}
          {node.rollup.modified > 0 && <span className="rollup rollup--modified">{node.rollup.modified}●</span>}
          {node.rollup.inherited > 0 && <span className="rollup rollup--inherited">{node.rollup.inherited} inh</span>}
        </span>
      )}
    </div>
  );
}
