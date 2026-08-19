// The only place the app touches @ignition-diff/engine directly. Runs off
// the main thread so parsing/diffing large files never blocks the UI
// (PLAN.md §1, §3.4). Keeps the parsed TagFiles (with full `raw` payloads)
// in its own module scope; the main thread only ever receives compact
// summaries (DiffIndex has no `raw` in it) or on-demand per-node results.
//
// Two independent flows share this one worker: the diff/merge flow
// (fileA/fileB/diffIndex) and the standalone single-file transform flow
// (singleFile) — PLAN.md §5's "usable standalone... without a diff". They
// never interact; a user is only ever in one screen at a time.

import {
  applyFindReplace,
  applyMergePlan,
  applyStrip,
  buildMergePlan,
  computePropDiff,
  DEFAULT_IGNORED_KEYS,
  diffTagFiles,
  extractSubtree,
  findMissingUdtDefs,
  parseTagFile,
  previewFindReplace,
  pullInUdtDefs,
  serializeTagFile,
  validateTagFile,
  type DiffIndex,
  type FindReplaceChange,
  type FindReplaceOptions,
  type MergeDirection,
  type MergeSide,
  type PropDiff,
  type StripOptions,
  type TagFile,
  type ValidationIssue,
} from '@ignition-diff/engine';

let fileA: TagFile | null = null;
let fileB: TagFile | null = null;
let diffIndex: DiffIndex | null = null;
// Retained so the ignore-list can change without re-loading files: a new
// ignore-list requires re-hashing (parseTagFile bakes ignoredKeys into
// ownHash/structuralHash at parse time — PLAN.md §3.2), so we re-parse the
// original text rather than trying to patch hashes after the fact.
let fileAText = '';
let fileBText = '';
let fileAName = '';
let fileBName = '';
let ignoredKeys: string[] = [...DEFAULT_IGNORED_KEYS];

let singleFile: TagFile | null = null;

interface DiffRequest {
  fileAName: string;
  fileAText: string;
  fileBName: string;
  fileBText: string;
}

interface PropDiffRequest {
  path: string;
}

interface SetIgnoredKeysRequest {
  ignoredKeys: string[];
}

interface MergeSelectionPayload {
  selection: string[];
  resolutions: Array<[string, MergeSide]>;
  /** Per-property cherry-pick overrides: diff path -> array of [PropDiff.key, side]. */
  cherryPicks: Array<[string, Array<[string, MergeSide]>]>;
  direction: MergeDirection;
  mirrorDeletions: boolean;
  autoPullInMissingDefs: boolean;
  /** 'FULL' for the whole merged tree, or a diff path to export just that subtree. */
  scope: 'FULL' | string;
}

export interface ExportRequest extends MergeSelectionPayload {
  findReplace: { options: FindReplaceOptions; changes: FindReplaceChange[] } | null;
  strip: StripOptions | null;
}

export interface ExportResponse {
  text: string;
  missingUdtDefs: Array<{ instancePath: string; typeId: string }>;
  suggestedFileName: string;
  validationIssues: ValidationIssue[];
}

interface TransformPreviewRequest extends MergeSelectionPayload {
  findReplace: FindReplaceOptions;
}

interface LoadSingleRequest {
  fileName: string;
  fileText: string;
}

export interface LoadSingleResponse {
  validationIssues: ValidationIssue[];
}

interface SingleTransformExportRequest {
  findReplaceChanges: FindReplaceChange[];
  strip: StripOptions;
}

export interface SingleTransformExportResponse {
  text: string;
  suggestedFileName: string;
  validationIssues: ValidationIssue[];
}

type Handlers = {
  diff: (payload: DiffRequest) => DiffIndex;
  propDiff: (payload: PropDiffRequest) => PropDiff[];
  setIgnoredKeys: (payload: SetIgnoredKeysRequest) => DiffIndex;
  export: (payload: ExportRequest) => ExportResponse;
  transformPreview: (payload: TransformPreviewRequest) => FindReplaceChange[];
  loadSingle: (payload: LoadSingleRequest) => LoadSingleResponse;
  singleFindReplacePreview: (payload: FindReplaceOptions) => FindReplaceChange[];
  singleTransformExport: (payload: SingleTransformExportRequest) => SingleTransformExportResponse;
};

function reparseAndDiff(): DiffIndex {
  fileA = parseTagFile(fileAText, fileAName, { ignoredKeys });
  fileB = parseTagFile(fileBText, fileBName, { ignoredKeys });
  diffIndex = diffTagFiles(fileA, fileB);
  return diffIndex;
}

/** Shared by `export` and `transformPreview` so a transform preview is
 *  always computed against the exact same merge result export would
 *  produce — never a guess based on fileA/fileB individually. */
function buildMergeOutput(payload: MergeSelectionPayload): { file: TagFile; missingUdtDefs: ExportResponse['missingUdtDefs']; scopeLabel: string } {
  if (!fileA || !fileB || !diffIndex) throw new Error('No files loaded yet');

  let plan = buildMergePlan({
    diffIndex,
    selection: new Set(payload.selection),
    resolutions: new Map(payload.resolutions),
    cherryPicks: new Map(payload.cherryPicks.map(([path, entries]) => [path, new Map(entries)])),
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

  return { file: outFile, missingUdtDefs, scopeLabel };
}

const handlers: Handlers = {
  diff(payload) {
    fileAText = payload.fileAText;
    fileBText = payload.fileBText;
    fileAName = payload.fileAName;
    fileBName = payload.fileBName;
    return reparseAndDiff();
  },

  propDiff(payload) {
    if (!fileA || !fileB || !diffIndex) throw new Error('No files loaded yet');
    const node = diffIndex.byPath.get(payload.path);
    if (!node) throw new Error(`Unknown diff path: ${payload.path}`);
    // NOT `node.aId ? ...` — aId/bId can legitimately be "" (empty-string root id).
    const aRaw = node.aId !== undefined ? fileA.nodes.get(node.aId)?.raw : undefined;
    const bRaw = node.bId !== undefined ? fileB.nodes.get(node.bId)?.raw : undefined;
    return computePropDiff(aRaw, bRaw, new Set(ignoredKeys));
  },

  setIgnoredKeys(payload) {
    if (!fileAText || !fileBText) throw new Error('No files loaded yet');
    ignoredKeys = payload.ignoredKeys;
    return reparseAndDiff();
  },

  transformPreview(payload) {
    const { file } = buildMergeOutput(payload);
    return previewFindReplace(file, payload.findReplace);
  },

  export(payload) {
    let { file: outFile, missingUdtDefs, scopeLabel } = buildMergeOutput(payload);

    if (payload.findReplace) {
      outFile = applyFindReplace(outFile, payload.findReplace.changes);
    }
    if (payload.strip) {
      outFile = applyStrip(outFile, payload.strip);
    }

    const text = serializeTagFile(outFile);
    const baseName = payload.direction === 'into-a' ? fileA!.filePath : payload.direction === 'into-b' ? fileB!.filePath : 'merged-export.json';
    const suggestedFileName = scopeLabel ? `${scopeLabel}_tags.json` : baseName;
    const validationIssues = validateTagFile(outFile);

    return { text, missingUdtDefs, suggestedFileName, validationIssues };
  },

  loadSingle(payload) {
    singleFile = parseTagFile(payload.fileText, payload.fileName);
    return { validationIssues: validateTagFile(singleFile) };
  },

  singleFindReplacePreview(payload) {
    if (!singleFile) throw new Error('No file loaded yet');
    return previewFindReplace(singleFile, payload);
  },

  singleTransformExport(payload) {
    if (!singleFile) throw new Error('No file loaded yet');
    let outFile = applyFindReplace(singleFile, payload.findReplaceChanges);
    outFile = applyStrip(outFile, payload.strip);
    const text = serializeTagFile(outFile);
    return { text, suggestedFileName: singleFile.filePath, validationIssues: validateTagFile(outFile) };
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
