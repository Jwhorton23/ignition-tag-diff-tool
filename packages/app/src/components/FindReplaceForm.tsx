import type { FindReplaceOptions } from '@ignition-diff/engine';

interface FindReplaceFormProps {
  options: FindReplaceOptions;
  onChange: (options: FindReplaceOptions) => void;
  onPreview: () => void;
  previewing: boolean;
  error: string | undefined;
}

export function FindReplaceForm({ options, onChange, onPreview, previewing, error }: FindReplaceFormProps) {
  return (
    <div className="find-replace-form">
      <label>
        Property
        <input
          type="text"
          placeholder="opcItemPath"
          value={options.property}
          onChange={(ev) => onChange({ ...options, property: ev.target.value })}
        />
      </label>
      <label>
        Find
        <input type="text" value={options.find} onChange={(ev) => onChange({ ...options, find: ev.target.value })} />
      </label>
      <label>
        Replace
        <input type="text" value={options.replace} onChange={(ev) => onChange({ ...options, replace: ev.target.value })} />
      </label>
      <label className="find-replace-form__checkbox">
        <input type="checkbox" checked={options.regex} onChange={(ev) => onChange({ ...options, regex: ev.target.checked })} />
        regex
      </label>
      <label className="find-replace-form__checkbox">
        <input type="checkbox" checked={options.caseSensitive} onChange={(ev) => onChange({ ...options, caseSensitive: ev.target.checked })} />
        case-sensitive
      </label>
      <button type="button" disabled={!options.property || !options.find || previewing} onClick={onPreview}>
        {previewing ? 'Previewing…' : 'Preview'}
      </button>
      {error && <div className="find-replace-form__error">{error}</div>}
    </div>
  );
}
