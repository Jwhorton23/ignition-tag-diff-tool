import type { FindReplaceChange, FindReplaceOptions, StripOptions } from '@ignition-diff/engine';
import { FindReplaceForm } from './FindReplaceForm';
import { FindReplacePreviewTable } from './FindReplacePreviewTable';
import { StripChecklist } from './StripChecklist';

interface TransformsSectionProps {
  findReplaceOptions: FindReplaceOptions;
  onFindReplaceOptionsChange: (options: FindReplaceOptions) => void;
  onPreview: () => void;
  previewing: boolean;
  previewError: string | undefined;
  previewChanges: FindReplaceChange[] | undefined;
  includedPaths: ReadonlySet<string>;
  onToggleIncluded: (path: string) => void;
  onToggleAllIncluded: (include: boolean) => void;
  stripOptions: StripOptions;
  onStripOptionsChange: (options: StripOptions) => void;
}

/** Find/replace + strip/normalize, composed for reuse in both the diff-mode
 *  export flow and the standalone single-file transform screen (PLAN.md §5). */
export function TransformsSection({
  findReplaceOptions,
  onFindReplaceOptionsChange,
  onPreview,
  previewing,
  previewError,
  previewChanges,
  includedPaths,
  onToggleIncluded,
  onToggleAllIncluded,
  stripOptions,
  onStripOptionsChange,
}: TransformsSectionProps) {
  return (
    <div className="transforms-section">
      <div className="transforms-section__block">
        <h3>Find &amp; replace</h3>
        <FindReplaceForm options={findReplaceOptions} onChange={onFindReplaceOptionsChange} onPreview={onPreview} previewing={previewing} error={previewError} />
        {previewChanges && (
          <FindReplacePreviewTable changes={previewChanges} included={includedPaths} onToggle={onToggleIncluded} onToggleAll={onToggleAllIncluded} />
        )}
      </div>
      <div className="transforms-section__block">
        <h3>Strip / normalize on export</h3>
        <StripChecklist options={stripOptions} onChange={onStripOptionsChange} />
      </div>
    </div>
  );
}
