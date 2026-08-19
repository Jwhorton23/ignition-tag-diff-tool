// Core data model for the Ignition Tag Diff & Merge Tool engine.
// See PLAN.md §2 for the design rationale behind these shapes.
//
// Fidelity rule: `TagNode.raw` always holds the exact object produced by
// JSON.parse for that node (minus a placeholder swap for "tags", see parse.ts),
// so unknown/future Ignition properties ride along untouched. Nothing in this
// package is allowed to mutate a `raw` object in place — transforms and merges
// always produce copies.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/** Coarse classification derived from `tagType` + position in the tree. */
export type NodeKind =
  | 'provider'
  | 'folder'
  | 'udt-def' // a node under a "_types_" folder with tagType "UdtType"
  | 'udt-instance' // tagType "UdtInstance"
  | 'tag' // AtomicTag, OPC, memory, expression, query, derived, etc.
  | 'unknown'; // tagType missing or unrecognized — never dropped, just unclassified

export interface TagNode {
  /** Canonical path id, "/"-joined from the file root, case-preserved. */
  id: string;
  name: string;
  kind: NodeKind;
  /** Raw `tagType` string as it appeared in the source, e.g. "AtomicTag". */
  tagType?: string;
  /** For udt-instance nodes: the UDT type name referenced via `typeId`. */
  typeId?: string;
  /** The original parsed object for this node, See fidelity rule above. */
  raw: JsonObject;
  /** Child node ids in the SAME order as `sourceIndex` (i.e. already sorted). */
  childIds: string[];
  /** Hash of this node's OWN (ignore-list-filtered) properties only — no
   *  children folded in. This is what diff status comparison uses, so a
   *  folder isn't marked "modified" just because a descendant changed. */
  ownHash: string;
  /** Hash of this node's own properties PLUS its children's hashes —
   *  changes anywhere in the subtree change this. Reserved for a future
   *  "skip this whole subtree, it's identical" diff fast-path; not used for
   *  per-node status today (see `ownHash`). */
  structuralHash: string;
  /** Original index within the parent's "tags" array — preserves file ordering. */
  sourceIndex: number;
  parentId: string | null;
}

export interface TagFileMeta {
  /** Best-effort guess; 'unknown' unless a real fixture proves a reliable signal. */
  detectedVersionHint: '8.1' | '8.3' | 'unknown';
  hadBom: boolean;
  eol: 'lf' | 'crlf';
  /** Shape of the JSON root, so the serializer can reproduce it exactly. */
  rootShape: 'provider' | 'folder-array' | 'single-node';
}

export interface TagFile {
  filePath: string;
  /** Usually one id (a Provider or a single folder/tag), but folder-array
   *  exports can have multiple siblings at the root. */
  rootIds: string[];
  nodes: Map<string, TagNode>;
  /** UDT type name -> node id, built from any "_types_" subtree found. */
  udtDefs: Map<string, string>;
  meta: TagFileMeta;
}

export interface ParseOptions {
  /** Property names to exclude from structural hashing (not from `raw`). */
  ignoredKeys?: readonly string[];
}

// ---------------------------------------------------------------------------
// Diff model (types only for now — implementation lands in Phase 1).
// ---------------------------------------------------------------------------

export type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged' | 'type-changed';

export interface DiffRollup {
  added: number;
  removed: number;
  modified: number;
  inherited: number; // udt-impact 'def-changed' count, kept separate from `modified`
}

export type UdtImpact = 'def-changed' | 'def-missing-in-a' | 'def-missing-in-b';

export interface DiffNode {
  /** Alignment path — stable across A/B even when root/provider names differ. */
  path: string;
  /** Last path segment, for display. */
  name: string;
  parentPath: string | null;
  status: DiffStatus;
  /** Best-available kind for icon/glyph purposes: B's kind if present, else A's. */
  kind: NodeKind;
  /** Cheap, search/filter-friendly summary fields (from B's raw if present, else A's) —
   *  small scalars only, never the full `raw` payload (PLAN.md §1's compact-summary rule). */
  tagType?: string;
  dataType?: string;
  hasAlarms: boolean;
  hasScripts: boolean;
  aId?: string;
  bId?: string;
  childPaths: string[];
  rollup: DiffRollup;
  udtImpact?: UdtImpact;
  caseOnlyRename?: boolean;
}

export interface DiffIndex {
  byPath: Map<string, DiffNode>;
  rootPaths: string[];
}

export interface PropDiff {
  /** Dotted/bracketed path into `raw`, e.g. "alarms[HiHi].setpoint". */
  key: string;
  status: 'added' | 'removed' | 'changed';
  aValue?: JsonValue;
  bValue?: JsonValue;
  renderHint: 'scalar' | 'script' | 'json';
  ignored: boolean;
}

// ---------------------------------------------------------------------------
// Merge model (types only for now — implementation lands in Phase 1).
// ---------------------------------------------------------------------------

export type MergeDirection = 'into-a' | 'into-b' | 'new-file';
export type MergeSide = 'a' | 'b';

export type MergeOp =
  | { op: 'add'; path: string; from: MergeSide }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; from: MergeSide }
  | { op: 'patch'; path: string; props: Array<{ key: string; from: MergeSide }> };

export interface Transform {
  kind: 'find-replace' | 'strip';
  // Concrete shapes land in Phase 3 alongside the transform engine.
  [key: string]: JsonValue | undefined;
}

export interface MergePlan {
  direction: MergeDirection;
  baseFile: MergeSide | null;
  ops: MergeOp[];
  transforms: Transform[];
}
