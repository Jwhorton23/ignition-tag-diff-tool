// The only place the app touches @ignition-diff/engine directly. Runs off
// the main thread so parsing/diffing large files never blocks the UI
// (PLAN.md §1, §3.4). Keeps the parsed TagFiles (with full `raw` payloads)
// in its own module scope; the main thread only ever receives compact
// summaries (DiffIndex has no `raw` in it) or on-demand per-node results.

import {
  applyMergePlan,
  buildMergePlan,
  computePropDiff,
  DEFAULT_IGNORED_KEYS,
  diffTagFiles,
  extractSubtree,
  findMissingUdtDefs,
  parseTagFile,
  pullInUdtDefs,
  serializeTagFile,
  type DiffIndex,
  type MergeDirection,
  type MergeSide,
  type PropDiff,
  type TagFile,
} from '@ignition-diff/engine';

let fileA: TagFile | null = null;
let fileB: TagFile | null = null;
let diffIndex: DiffIndex | null = null;

interface DiffRequest {
  fileAName: string;
  fileAText: string;
  fileBName: string;
  fileBText: string;
}

interface PropDiffRequest {
  path: string;
}

export interface ExportRequest {
  selection: string[];
  resolutions: Array<[string, MergeSide]>;
  direction: MergeDirection;
  mirrorDeletions: boolean;
  autoPullInMissingDefs: boolean;
  /** 'FULL' for the whole merged tree, or a diff path to export just that subtree. */
  scope: 'FULL' | string;
}

export interface ExportResponse {
  text: string;
  missingUdtDefs: Array<{ instancePath: string; typeId: string }>;
  suggestedFileName: string;
}

type Handlers = {
  diff: (payload: DiffRequest) => DiffIndex;
  propDiff: (payload: PropDiffRequest) => PropDiff[];
  export: (payload: ExportRequest) => ExportResponse;
};

const handlers: Handlers = {
  diff(payload) {
    fileA = parseTagFile(payload.fileAText, payload.fileAName);
    fileB = parseTagFile(payload.fileBText, payload.fileBName);
    diffIndex = diffTagFiles(fileA, fileB);
    return diffIndex;
  },

  propDiff(payload) {
    if (!fileA || !fileB || !diffIndex) throw new Error('No files loaded yet');
    const node = diffIndex.byPath.get(payload.path);
    if (!node) throw new Error(`Unknown diff path: ${payload.path}`);
    const aRaw = node.aId ? fileA.nodes.get(node.aId)?.raw : undefined;
    const bRaw = node.bId ? fileB.nodes.get(node.bId)?.raw : undefined;
    return computePropDiff(aRaw, bRaw, new Set(DEFAULT_IGNORED_KEYS));
  },

  export(payload) {
    if (!fileA || !fileB || !diffIndex) throw new Error('No files loaded yet');

    let plan = buildMergePlan({
      diffIndex,
      selection: new Set(payload.selection),
      resolutions: new Map(payload.resolutions),
      direction: payload.direction,
      mirrorDeletions: payload.mirrorDeletions,
    });

    let applied = applyMergePlan(fileA, fileB, plan);
    if (payload.autoPullInMissingDefs && applied.missingUdtDefs.length > 0) {
      plan = pullInUdtDefs(fileA, fileB, plan, applied.missingUdtDefs);
      applied = applyMergePlan(fileA, fileB, plan);
    }

    let outFile = applied.file;
    let missingUdtDefs = applied.missingUdtDefs;
    let scopeLabel = '';
    if (payload.scope !== 'FULL') {
      outFile = extractSubtree(outFile, payload.scope);
      missingUdtDefs = findMissingUdtDefs(outFile);
      scopeLabel = payload.scope.replace(/^R\d+\/?/, '').replace(/\//g, '_');
    }

    const text = serializeTagFile(outFile);
    const baseName = payload.direction === 'into-a' ? fileA.filePath : payload.direction === 'into-b' ? fileB.filePath : 'merged-export.json';
    const suggestedFileName = scopeLabel ? `${scopeLabel}_tags.json` : baseName;

    return { text, missingUdtDefs, suggestedFileName };
  },
};

self.onmessage = (ev: MessageEvent) => {
  const { id, type, payload } = ev.data as { id: number; type: keyof Handlers; payload: unknown };
  try {
    const handler = handlers[type] as (p: unknown) => unknown;
    const result = handler(payload);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
