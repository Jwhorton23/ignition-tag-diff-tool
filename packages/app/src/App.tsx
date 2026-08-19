import { useEffect, useMemo, useState } from 'react';
import type { DiffIndex, MergeDirection, MergeSide, MissingUdtDef, PropDiff } from '@ignition-diff/engine';
import './App.css';
import { LoadScreen } from './components/LoadScreen';
import { DiffTree } from './components/DiffTree';
import { DetailPane } from './components/DetailPane';
import { ExportPanel } from './components/ExportPanel';
import { callWorker } from './worker/rpc';
import { saveTextFile, type LoadedFile } from './lib/fileAccess';
import { computeDefaultExpanded, listFolderPaths, toggleSelection, unresolvedConflicts } from './lib/treeHelpers';
import type { ExportRequest, ExportResponse } from './worker/engineWorker';

interface ExportPreview {
  text: string;
  suggestedFileName: string;
  missingUdtDefs: MissingUdtDef[];
}

export default function App() {
  const [fileAName, setFileAName] = useState('');
  const [fileBName, setFileBName] = useState('');
  const [diffIndex, setDiffIndex] = useState<DiffIndex | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<Map<string, MergeSide>>(new Map());
  const [openPath, setOpenPath] = useState<string | undefined>();
  const [propDiffCache, setPropDiffCache] = useState<Map<string, PropDiff[]>>(new Map());
  const [propDiffLoading, setPropDiffLoading] = useState(false);

  const [direction, setDirection] = useState<MergeDirection>('into-a');
  const [mirrorDeletions, setMirrorDeletions] = useState(false);
  const [scope, setScope] = useState('FULL');
  const [exporting, setExporting] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<ExportPreview | null>(null);

  async function handleReady(fileA: LoadedFile, fileB: LoadedFile) {
    setLoading(true);
    setLoadError(undefined);
    try {
      const index = await callWorker<DiffIndex>('diff', {
        fileAName: fileA.name,
        fileAText: fileA.text,
        fileBName: fileB.name,
        fileBText: fileB.text,
      });
      setFileAName(fileA.name);
      setFileBName(fileB.name);
      setDiffIndex(index);
      setExpanded(computeDefaultExpanded(index));
      setSelected(new Set());
      setResolutions(new Map());
      setOpenPath(undefined);
      setPropDiffCache(new Map());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleToggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleToggleSelect(path: string) {
    if (!diffIndex) return;
    setSelected((prev) => toggleSelection(diffIndex, prev, path));
  }

  function handleOpen(path: string) {
    setOpenPath(path);
  }

  useEffect(() => {
    if (!openPath || propDiffCache.has(openPath)) return;
    setPropDiffLoading(true);
    callWorker<PropDiff[]>('propDiff', { path: openPath })
      .then((rows) => {
        setPropDiffCache((prev) => new Map(prev).set(openPath, rows));
      })
      .finally(() => setPropDiffLoading(false));
  }, [openPath, propDiffCache]);

  function handleResolve(side: MergeSide) {
    if (!openPath) return;
    setResolutions((prev) => new Map(prev).set(openPath, side));
  }

  const folderPaths = useMemo(() => (diffIndex ? listFolderPaths(diffIndex) : []), [diffIndex]);
  const unresolvedCount = useMemo(
    () => (diffIndex ? unresolvedConflicts(diffIndex, selected, resolutions).length : 0),
    [diffIndex, selected, resolutions],
  );

  async function runExport(autoPullInMissingDefs: boolean): Promise<ExportResponse> {
    const payload: ExportRequest = {
      selection: [...selected],
      resolutions: [...resolutions.entries()],
      direction,
      mirrorDeletions,
      autoPullInMissingDefs,
      scope: scope as 'FULL' | string,
    };
    return callWorker<ExportResponse>('export', payload);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const result = await runExport(false);
      if (result.missingUdtDefs.length > 0) {
        setPendingPreview(result);
      } else {
        await saveTextFile(result.text, result.suggestedFileName);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  async function handleIncludeDefs() {
    setExporting(true);
    try {
      const result = await runExport(true);
      await saveTextFile(result.text, result.suggestedFileName);
    } finally {
      setExporting(false);
      setPendingPreview(null);
    }
  }

  async function handleExportAnyway() {
    if (!pendingPreview) return;
    await saveTextFile(pendingPreview.text, pendingPreview.suggestedFileName);
    setPendingPreview(null);
  }

  if (!diffIndex) {
    return (
      <div className="app">
        <LoadScreen onReady={(a, b) => void handleReady(a, b)} error={loadError} />
        {loading && <div className="loading-overlay">Parsing and diffing…</div>}
      </div>
    );
  }

  const openNode = openPath ? diffIndex.byPath.get(openPath) : undefined;

  return (
    <div className="app app--diff-view">
      <header className="app__header">
        <span>
          A: {fileAName} ⇄ B: {fileBName}
        </span>
        <span className="app__selected-count">{selected.size} staged</span>
      </header>
      <div className="app__body">
        <DiffTree
          diffIndex={diffIndex}
          expanded={expanded}
          onToggleExpand={handleToggleExpand}
          selected={selected}
          onToggleSelect={handleToggleSelect}
          openPath={openPath}
          onOpen={handleOpen}
        />
        <DetailPane
          node={openNode}
          fileAName={fileAName}
          fileBName={fileBName}
          rows={openPath ? propDiffCache.get(openPath) : undefined}
          loading={propDiffLoading && !!openPath && !propDiffCache.has(openPath)}
          resolution={openPath ? resolutions.get(openPath) : undefined}
          onResolve={handleResolve}
        />
      </div>
      <footer className="app__footer">
        <ExportPanel
          fileAName={fileAName}
          fileBName={fileBName}
          direction={direction}
          onDirectionChange={setDirection}
          mirrorDeletions={mirrorDeletions}
          onMirrorDeletionsChange={setMirrorDeletions}
          scope={scope}
          onScopeChange={setScope}
          folderPaths={folderPaths}
          selectedCount={selected.size}
          unresolvedCount={unresolvedCount}
          onExport={() => void handleExport()}
          exporting={exporting}
          pendingMissingDefs={pendingPreview?.missingUdtDefs ?? null}
          onIncludeDefs={() => void handleIncludeDefs()}
          onExportAnyway={() => void handleExportAnyway()}
          onCancelExport={() => setPendingPreview(null)}
        />
      </footer>
    </div>
  );
}
