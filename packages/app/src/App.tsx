import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_IGNORED_KEYS, type DiffIndex, type MergeDirection, type MergeSide, type MissingUdtDef, type PropDiff } from '@ignition-diff/engine';
import './App.css';
import { LoadScreen } from './components/LoadScreen';
import { DiffTree } from './components/DiffTree';
import { DetailPane } from './components/DetailPane';
import { ExportPanel } from './components/ExportPanel';
import { FilterBar } from './components/FilterBar';
import { IgnoreListPanel } from './components/IgnoreListPanel';
import { callWorker } from './worker/rpc';
import { saveTextFile, type LoadedFile } from './lib/fileAccess';
import {
  computeExpandedForVisible,
  computeFilterMatches,
  computeVisiblePaths,
  DEFAULT_FILTER_CRITERIA,
  flattenTree,
  hasForceIncludableUnchanged,
  isWholeSubtreeSelected,
  listDistinctValues,
  listFolderPaths,
  toggleSelection,
  toggleWholeSubtree,
  unresolvedConflicts,
  type FilterCriteria,
} from './lib/treeHelpers';
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
  const [cherryPicks, setCherryPicks] = useState<Map<string, Map<string, MergeSide>>>(new Map());
  const [openPath, setOpenPath] = useState<string | undefined>();
  const [propDiffCache, setPropDiffCache] = useState<Map<string, PropDiff[]>>(new Map());
  const [propDiffLoading, setPropDiffLoading] = useState(false);

  const [filterCriteria, setFilterCriteria] = useState<FilterCriteria>(DEFAULT_FILTER_CRITERIA);
  const [ignoredKeys, setIgnoredKeysState] = useState<string[]>([...DEFAULT_IGNORED_KEYS]);
  const [ignoreListOpen, setIgnoreListOpen] = useState(false);
  const [ignoreListPending, setIgnoreListPending] = useState(false);

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
      const matches = computeFilterMatches(index, DEFAULT_FILTER_CRITERIA);
      setExpanded(computeExpandedForVisible(index, computeVisiblePaths(index, matches)));
      setFilterCriteria(DEFAULT_FILTER_CRITERIA);
      setSelected(new Set());
      setResolutions(new Map());
      setCherryPicks(new Map());
      setOpenPath(undefined);
      setPropDiffCache(new Map());
      setIgnoredKeysState([...DEFAULT_IGNORED_KEYS]);
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

  function handleToggleWholeSubtree(path: string) {
    if (!diffIndex) return;
    setSelected((prev) => toggleWholeSubtree(diffIndex, prev, path));
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
    // A whole-tag choice supersedes any partial cherry-pick for this tag.
    setCherryPicks((prev) => {
      if (!prev.has(openPath)) return prev;
      const next = new Map(prev);
      next.delete(openPath);
      return next;
    });
  }

  function handleCherryPick(propKey: string, side: MergeSide) {
    if (!openPath) return;
    setCherryPicks((prev) => {
      const next = new Map(prev);
      const forPath = new Map(next.get(openPath) ?? []);
      forPath.set(propKey, side);
      next.set(openPath, forPath);
      return next;
    });
  }

  async function handleFilterChange(criteria: FilterCriteria) {
    setFilterCriteria(criteria);
    if (!diffIndex) return;
    const matches = computeFilterMatches(diffIndex, criteria);
    const visible = computeVisiblePaths(diffIndex, matches);
    // Additive: newly-relevant ancestors auto-expand, but a folder the user
    // manually collapsed earlier stays collapsed — typing in the search box
    // shouldn't undo someone's manual tidying.
    setExpanded((prev) => new Set([...prev, ...computeExpandedForVisible(diffIndex, visible)]));
  }

  async function handleApplyIgnoredKeys(newKeys: string[]) {
    setIgnoreListPending(true);
    try {
      const index = await callWorker<DiffIndex>('setIgnoredKeys', { ignoredKeys: newKeys });
      setIgnoredKeysState(newKeys);
      setDiffIndex(index);
      const matches = computeFilterMatches(index, filterCriteria);
      setExpanded(computeExpandedForVisible(index, computeVisiblePaths(index, matches)));
      // Statuses/hashes may have shifted — stale selections/resolutions/cherry-picks
      // against paths that no longer differ (or don't exist) would be misleading.
      setSelected(new Set());
      setResolutions(new Map());
      setCherryPicks(new Map());
      setOpenPath(undefined);
      setPropDiffCache(new Map());
      setIgnoreListOpen(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIgnoreListPending(false);
    }
  }

  const folderPaths = useMemo(() => (diffIndex ? listFolderPaths(diffIndex) : []), [diffIndex]);
  const tagTypeOptions = useMemo(() => (diffIndex ? listDistinctValues(diffIndex, 'tagType') : []), [diffIndex]);
  const dataTypeOptions = useMemo(() => (diffIndex ? listDistinctValues(diffIndex, 'dataType') : []), [diffIndex]);

  const filterMatches = useMemo(() => (diffIndex ? computeFilterMatches(diffIndex, filterCriteria) : new Set<string>()), [diffIndex, filterCriteria]);
  const visiblePaths = useMemo(() => (diffIndex ? computeVisiblePaths(diffIndex, filterMatches) : new Set<string>()), [diffIndex, filterMatches]);
  const rows = useMemo(() => (diffIndex ? flattenTree(diffIndex, expanded, visiblePaths) : []), [diffIndex, expanded, visiblePaths]);

  const unresolvedCount = useMemo(
    () => (diffIndex ? unresolvedConflicts(diffIndex, selected, resolutions, cherryPicks).length : 0),
    [diffIndex, selected, resolutions, cherryPicks],
  );

  async function runExport(autoPullInMissingDefs: boolean): Promise<ExportResponse> {
    const payload: ExportRequest = {
      selection: [...selected],
      resolutions: [...resolutions.entries()],
      cherryPicks: [...cherryPicks.entries()].map(([path, props]) => [path, [...props.entries()]]),
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

  const openNode = openPath ? diffIndex?.byPath.get(openPath) : undefined;

  // Keyboard nav: j/k move focus through the currently visible rows, space
  // toggles the focused row's selection, enter opens it (redundant with j/k
  // already opening, but explicit), a/b resolve a conflict on the open tag.
  // Ignored while typing in an input/select/textarea (the search box, the
  // ignore-list editor, etc.).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;
  const diffIndexRef = useRef(diffIndex);
  diffIndexRef.current = diffIndex;

  useEffect(() => {
    if (!diffIndex) return;
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
    }

    function handleKeyDown(ev: KeyboardEvent) {
      if (isTypingTarget(ev.target)) return;
      const currentRows = rowsRef.current;
      const currentOpenPath = openPathRef.current;
      const currentDiffIndex = diffIndexRef.current;
      if (!currentDiffIndex) return;

      if (ev.key === 'j' || ev.key === 'k') {
        ev.preventDefault();
        const idx = currentRows.findIndex((r) => r.path === currentOpenPath);
        const nextIdx = ev.key === 'j' ? Math.min(currentRows.length - 1, idx + 1) : Math.max(0, idx - 1);
        const nextRow = currentRows[idx === -1 ? 0 : nextIdx];
        if (nextRow) setOpenPath(nextRow.path);
      } else if (ev.key === ' ') {
        ev.preventDefault();
        if (currentOpenPath) handleToggleSelect(currentOpenPath);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        // Already open via j/k/click — Enter re-affirms/no-ops, kept for discoverability.
      } else if ((ev.key === 'a' || ev.key === 'b') && currentOpenPath) {
        const node = currentDiffIndex.byPath.get(currentOpenPath);
        if (node && (node.status === 'modified' || node.status === 'type-changed')) {
          ev.preventDefault();
          // NOT a call to handleResolve() — that closure is only freshly
          // recreated when this effect re-runs (dependency array is just
          // [diffIndex]), so its captured `openPath` would be stale on every
          // keystroke after the first. Use the ref-derived currentOpenPath
          // (always current) and inline the same two state updates instead.
          const side = ev.key as MergeSide;
          const path = currentOpenPath;
          setResolutions((prev) => new Map(prev).set(path, side));
          setCherryPicks((prev) => {
            if (!prev.has(path)) return prev;
            const next = new Map(prev);
            next.delete(path);
            return next;
          });
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffIndex]);

  if (!diffIndex) {
    return (
      <div className="app">
        <LoadScreen onReady={(a, b) => void handleReady(a, b)} error={loadError} />
        {loading && <div className="loading-overlay">Parsing and diffing…</div>}
      </div>
    );
  }

  function handleNewComparison() {
    setDiffIndex(undefined);
    setFileAName('');
    setFileBName('');
    setLoadError(undefined);
    setExpanded(new Set());
    setSelected(new Set());
    setResolutions(new Map());
    setCherryPicks(new Map());
    setOpenPath(undefined);
    setPropDiffCache(new Map());
    setFilterCriteria(DEFAULT_FILTER_CRITERIA);
    setDirection('into-a');
    setMirrorDeletions(false);
    setScope('FULL');
    setPendingPreview(null);
  }

  return (
    <div className="app app--diff-view">
      <header className="app__header">
        <button type="button" className="back-button" onClick={handleNewComparison}>
          ← New comparison
        </button>
        <span>
          A: {fileAName} ⇄ B: {fileBName}
        </span>
        <span className="app__selected-count">{selected.size} staged</span>
      </header>
      <FilterBar
        criteria={filterCriteria}
        onChange={(c) => void handleFilterChange(c)}
        tagTypeOptions={tagTypeOptions}
        dataTypeOptions={dataTypeOptions}
        matchCount={filterMatches.size}
        onOpenIgnoreList={() => setIgnoreListOpen(true)}
      />
      <div className="app__body">
        <DiffTree
          diffIndex={diffIndex}
          rows={rows}
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
          cherryPicks={openPath ? cherryPicks.get(openPath) : undefined}
          onCherryPick={handleCherryPick}
          forceIncludable={!!diffIndex && !!openPath && hasForceIncludableUnchanged(diffIndex, openPath)}
          wholeSubtreeSelected={!!diffIndex && !!openPath && isWholeSubtreeSelected(diffIndex, selected, openPath)}
          onToggleWholeSubtree={() => openPath && handleToggleWholeSubtree(openPath)}
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
      <IgnoreListPanel
        open={ignoreListOpen}
        currentKeys={ignoredKeys}
        pending={ignoreListPending}
        onApply={(keys) => void handleApplyIgnoredKeys(keys)}
        onClose={() => setIgnoreListOpen(false)}
      />
    </div>
  );
}
