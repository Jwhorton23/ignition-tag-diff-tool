import type { StripOptions } from '@ignition-diff/engine';

interface StripChecklistProps {
  options: StripOptions;
  onChange: (options: StripOptions) => void;
}

const ITEMS: Array<{ key: keyof StripOptions; label: string }> = [
  { key: 'removeHistory', label: 'Remove history config' },
  { key: 'removeAlarms', label: 'Remove alarms' },
  { key: 'clearValues', label: 'Clear values' },
  { key: 'removeDocumentation', label: 'Remove documentation/tooltips' },
];

export function StripChecklist({ options, onChange }: StripChecklistProps) {
  return (
    <div className="strip-checklist">
      {ITEMS.map(({ key, label }) => (
        <label key={key}>
          <input type="checkbox" checked={options[key]} onChange={(ev) => onChange({ ...options, [key]: ev.target.checked })} />
          {label}
        </label>
      ))}
    </div>
  );
}
