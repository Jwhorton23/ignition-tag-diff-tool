import { useState } from 'react';
import type { FindReplaceChange, FindReplaceOptions, MergeDirection, MissingUdtDef, StripOptions, ValidationIssue } from '@ignition-diff/engine';
import { TransformsSection } from './TransformsSection';
import { ValidationPanel } from './ValidationPanel';

interface ExportPanelProps {
  fileAName: string;
  fileBName: string;
  direction: MergeDirection;
  onDirectionChange: (direction: MergeDirection) => void;
  mirrorDeletions: boolean;
  onMirrorDeletionsChange: (value: boolean) => void;
  scope: string; // 'FULL' or a diff path
  onScopeChange: (scope: string) => void;
  folderPaths: string[];
  selectedCount: number;
  unresolvedCount: number;
  onExport: () => void;
  exporting: boolean;
  pendingMissingDefs: MissingUdtDef[] | null;
  onIncludeDefs: () => void;
  onExportAnyway: () => void;
  onCancelExport: () => void;
  lastExportValidationIssues: ValidationIssue[];
  onNavigateToPath: (path: string) => void;

  findReplaceOptions: FindReplaceOptions;
  onFindReplaceOptionsChange: (options: FindReplaceOptions) => void;
  onPreviewFindReplace: () => void;
  previewingFindReplace: boolean;
  findReplacePreviewError: string | undefined;
  findReplacePreviewChanges: FindReplaceChange[] | undefined;
  findReplaceIncludedPaths: ReadonlySet<string>;
  onToggleFindReplaceIncluded: (path: string) => void;
  onToggleAllFindReplaceIncluded: (include: boolean) => void;
  stripOptions: StripOptions;
  onStripOptionsChange: (options: StripOptions) => void;
}

export function ExportPanel({
  fileAName,
  fileBName,
  direction,
  onDirectionChange,
  mirrorDeletions,
  onMirrorDeletionsChange,
  scope,
  onScopeChange,
  folderPaths,
  selectedCount,
  unresolvedCount,
  onExport,
  exporting,
  pendingMissingDefs,
  onIncludeDefs,
  onExportAnyway,
  onCancelExport,
  lastExportValidationIssues,
  onNavigateToPath,
  findReplaceOptions,
  onFindReplaceOptionsChange,
  onPreviewFindReplace,
  previewingFindReplace,
  findReplacePreviewError,
  findReplacePreviewChanges,
  findReplaceIncludedPaths,
  onToggleFindReplaceIncluded,
  onToggleAllFindReplaceIncluded,
  stripOptions,
  onStripOptionsChange,
}: ExportPanelProps) {
  const [transformsOpen, setTransformsOpen] = useState(false);
  const canExport = selectedCount > 0 && unresolvedCount === 0 && !exporting;

  return (
    <div className="export-panel-wrap">
      <div className="export-panel">
        <label>
          Direction
          <select value={direction} onChange={(ev) => onDirectionChange(ev.target.value as MergeDirection)}>
            <option value="into-a">Into A ({fileAName})</option>
            <option value="into-b">Into B ({fileBName})</option>
            <option value="new-file">New file</option>
          </select>
        </label>

        <label>
          <input type="checkbox" checked={mirrorDeletions} onChange={(ev) => onMirrorDeletionsChange(ev.target.checked)} />
          Mirror deletions
        </label>

        <label>
          Scope
          <select value={scope} onChange={(ev) => onScopeChange(ev.target.value)}>
            <option value="FULL">Full tree</option>
            {folderPaths.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="export-panel__transforms-toggle" onClick={() => setTransformsOpen(!transformsOpen)}>
          {transformsOpen ? '▾' : '▸'} Transforms
        </button>

        <div className="export-panel__summary">
          {selectedCount} selected{unresolvedCount > 0 && `, ${unresolvedCount} unresolved conflict${unresolvedCount === 1 ? '' : 's'}`}
        </div>

        <button type="button" className="primary-button" disabled={!canExport} onClick={onExport}>
          {exporting ? 'Exporting…' : 'Export…'}
        </button>
      </div>

      {transformsOpen && (
        <TransformsSection
          findReplaceOptions={findReplaceOptions}
          onFindReplaceOptionsChange={onFindReplaceOptionsChange}
          onPreview={onPreviewFindReplace}
          previewing={previewingFindReplace}
          previewError={findReplacePreviewError}
          previewChanges={findReplacePreviewChanges}
          includedPaths={findReplaceIncludedPaths}
          onToggleIncluded={onToggleFindReplaceIncluded}
          onToggleAllIncluded={onToggleAllFindReplaceIncluded}
          stripOptions={stripOptions}
          onStripOptionsChange={onStripOptionsChange}
        />
      )}

      <ValidationPanel issues={lastExportValidationIssues} onNavigate={onNavigateToPath} />

      {pendingMissingDefs && pendingMissingDefs.length > 0 && (
        <div className="missing-defs-prompt">
          <p>
            {pendingMissingDefs.length} UDT instance{pendingMissingDefs.length === 1 ? '' : 's'} reference a definition not included in this export:
          </p>
          <ul>
            {pendingMissingDefs.map((m) => (
              <li key={m.instancePath}>
                <code>{m.instancePath}</code> needs <code>{m.typeId}</code>
              </li>
            ))}
          </ul>
          <div className="missing-defs-prompt__actions">
            <button type="button" className="primary-button" onClick={onIncludeDefs}>
              Include required definitions
            </button>
            <button type="button" onClick={onExportAnyway}>
              Export anyway
            </button>
            <button type="button" onClick={onCancelExport}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
