import type { DiffStatus } from '@ignition-diff/engine';
import type { FilterCriteria } from '../lib/treeHelpers';

const STATUS_CHIPS: Array<{ status: DiffStatus; label: string; className: string }> = [
  { status: 'added', label: 'added', className: 'chip--added' },
  { status: 'removed', label: 'removed', className: 'chip--removed' },
  { status: 'modified', label: 'modified', className: 'chip--modified' },
  { status: 'type-changed', label: 'type-changed', className: 'chip--modified' },
  { status: 'unchanged', label: 'unchanged', className: 'chip--unchanged' },
];

interface FilterBarProps {
  criteria: FilterCriteria;
  onChange: (criteria: FilterCriteria) => void;
  tagTypeOptions: string[];
  dataTypeOptions: string[];
  matchCount: number;
  onOpenIgnoreList: () => void;
}

export function FilterBar({ criteria, onChange, tagTypeOptions, dataTypeOptions, matchCount, onOpenIgnoreList }: FilterBarProps) {
  function toggleStatus(status: DiffStatus) {
    const next = new Set(criteria.statuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    onChange({ ...criteria, statuses: next });
  }

  return (
    <div className="filter-bar">
      <input
        className="filter-bar__search"
        type="text"
        placeholder="Filter by name or path…"
        value={criteria.searchText}
        onChange={(ev) => onChange({ ...criteria, searchText: ev.target.value })}
      />

      <div className="filter-bar__chips">
        {STATUS_CHIPS.map(({ status, label, className }) => (
          <button
            key={status}
            type="button"
            className={`chip ${className}${criteria.statuses.has(status) ? ' chip--active' : ''}`}
            onClick={() => toggleStatus(status)}
          >
            {label}
          </button>
        ))}
      </div>

      <select value={criteria.tagType} onChange={(ev) => onChange({ ...criteria, tagType: ev.target.value })}>
        <option value="">Any type</option>
        {tagTypeOptions.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <select value={criteria.dataType} onChange={(ev) => onChange({ ...criteria, dataType: ev.target.value })}>
        <option value="">Any data type</option>
        {dataTypeOptions.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <label>
        <input type="checkbox" checked={criteria.hasAlarms} onChange={(ev) => onChange({ ...criteria, hasAlarms: ev.target.checked })} />
        has alarms
      </label>
      <label>
        <input type="checkbox" checked={criteria.hasScripts} onChange={(ev) => onChange({ ...criteria, hasScripts: ev.target.checked })} />
        has scripts
      </label>

      <span className="filter-bar__count">{matchCount} match{matchCount === 1 ? '' : 'es'}</span>

      <button type="button" className="filter-bar__ignore-list-btn" onClick={onOpenIgnoreList}>
        ☰ Ignore list
      </button>
    </div>
  );
}
