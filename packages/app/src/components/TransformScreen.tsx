import { useEffect, useState } from 'react';
import type { FindReplaceChange, FindReplaceOptions, StripOptions, ValidationIssue } from '@ignition-diff/engine';
import { callWorker } from '../worker/rpc';
import { saveTextFile, type LoadedFile } from '../lib/fileAccess';
import type { LoadSingleResponse, SingleTransformExportResponse } from '../worker/engineWorker';
import { TransformsSection } from './TransformsSection';
import { ValidationPanel } from './ValidationPanel';

const EMPTY_FIND_REPLACE: FindReplaceOptions = { property: '', find: '', replace: '', regex: false, caseSensitive: false };
const EMPTY_STRIP: StripOptions = { removeHistory: false, removeAlarms: false, clearValues: false, removeDocumentation: false };

interface TransformScreenProps {
  file: LoadedFile;
  onBack: () => void;
}

/** Standalone single-file transform workflow (PLAN.md §5): load one file,
 *  find/replace and/or strip, export — no diff required. A self-contained
 *  screen (own state) rather than folded into the diff view's state
 *  machine, since it's a fundamentally different, simpler flow: a bulk
 *  transform utility, not a tree browser. */
export function TransformScreen({ file, onBack }: TransformScreenProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);

  const [findReplaceOptions, setFindReplaceOptions] = useState<FindReplaceOptions>(EMPTY_FIND_REPLACE);
  const [previewChanges, setPreviewChanges] = useState<FindReplaceChange[] | undefined>(undefined);
  const [includedPaths, setIncludedPaths] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | undefined>();
  const [stripOptions, setStripOptions] = useState<StripOptions>(EMPTY_STRIP);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await callWorker<LoadSingleResponse>('loadSingle', { fileName: file.name, fileText: file.text });
        if (!cancelled) setValidationIssues(result.validationIssues);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.name, file.text]);

  async function handlePreview() {
    setPreviewing(true);
    setPreviewError(undefined);
    try {
      const changes = await callWorker<FindReplaceChange[]>('singleFindReplacePreview', findReplaceOptions);
      setPreviewChanges(changes);
      setIncludedPaths(new Set(changes.map((c) => c.path)));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreviewChanges(undefined);
    } finally {
      setPreviewing(false);
    }
  }

  function handleToggleIncluded(path: string) {
    setIncludedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleToggleAllIncluded(include: boolean) {
    setIncludedPaths(include ? new Set((previewChanges ?? []).map((c) => c.path)) : new Set());
  }

  async function handleExport() {
    setExporting(true);
    try {
      const findReplaceChanges = (previewChanges ?? []).filter((c) => includedPaths.has(c.path));
      const result = await callWorker<SingleTransformExportResponse>('singleTransformExport', { findReplaceChanges, strip: stripOptions });
      setValidationIssues(result.validationIssues);
      await saveTextFile(result.text, result.suggestedFileName);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  const hasAnyTransform = (previewChanges && includedPaths.size > 0) || Object.values(stripOptions).some(Boolean);

  return (
    <div className="app app--transform-view">
      <header className="app__header">
        <button type="button" className="back-button" onClick={onBack}>
          ← New comparison
        </button>
        <span>Transform: {file.name}</span>
      </header>

      {loading && <div className="loading-overlay">Parsing…</div>}
      {loadError && <div className="load-screen__error">{loadError}</div>}

      {!loading && !loadError && (
        <div className="transform-screen__body">
          <ValidationPanel issues={validationIssues} />
          <TransformsSection
            findReplaceOptions={findReplaceOptions}
            onFindReplaceOptionsChange={setFindReplaceOptions}
            onPreview={() => void handlePreview()}
            previewing={previewing}
            previewError={previewError}
            previewChanges={previewChanges}
            includedPaths={includedPaths}
            onToggleIncluded={handleToggleIncluded}
            onToggleAllIncluded={handleToggleAllIncluded}
            stripOptions={stripOptions}
            onStripOptionsChange={setStripOptions}
          />
          <div className="transform-screen__export">
            <button type="button" className="primary-button" disabled={!hasAnyTransform || exporting} onClick={() => void handleExport()}>
              {exporting ? 'Exporting…' : 'Export…'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
