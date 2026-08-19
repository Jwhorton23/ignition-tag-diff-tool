// Parses an Ignition tag export JSON string into a TagFile: a flat node map
// keyed by canonical path, with structural hashes precomputed bottom-up.
// See PLAN.md §2.1 and §3.
//
// Design choice: this module uses JSON.parse/JSON.stringify (not a
// lossless-json reader). That preserves object key order (which is all that
// matters for round-trip fidelity — Ignition's importer does not care about
// property order) but normalizes numeric literal formatting (e.g. "1.0"
// parses to the number 1). PLAN.md §2.1 flags this as a Phase 0 decision to
// be confirmed against real gateway fixtures once available; if a fixture
// shows Ignition's importer is sensitive to numeric literal form, swap this
// module's parse/serialize pair for `lossless-json` — the TagNode/TagFile
// shapes above do not need to change, only `raw`'s value type would widen.

import type { JsonObject, JsonValue, NodeKind, ParseOptions, TagFile, TagFileMeta, TagNode } from './types.js';
import { computeNodeHash, computeOwnHash, DEFAULT_IGNORED_KEYS } from './hash.js';

export class TagParseError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
  ) {
    super(`${message} (${filePath})`);
    this.name = 'TagParseError';
  }
}

export function parseTagFile(text: string, filePath: string, options: ParseOptions = {}): TagFile {
  const hadBom = text.charCodeAt(0) === 0xfeff;
  const body = hadBom ? text.slice(1) : text;
  const eol: TagFileMeta['eol'] = body.includes('\r\n') ? 'crlf' : 'lf';
  const ignoredKeys = new Set<string>(options.ignoredKeys ?? DEFAULT_IGNORED_KEYS);

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(body) as JsonValue;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new TagParseError(`Invalid JSON: ${reason}`, filePath);
  }

  let rootShape: TagFileMeta['rootShape'];
  let rootObjs: JsonObject[];

  if (Array.isArray(parsed)) {
    rootShape = 'folder-array';
    rootObjs = parsed.filter(isJsonObject);
    if (rootObjs.length !== parsed.length) {
      throw new TagParseError('Root array contains a non-object element', filePath);
    }
  } else if (isJsonObject(parsed)) {
    rootShape = parsed.tagType === 'Provider' ? 'provider' : 'single-node';
    rootObjs = [parsed];
  } else {
    throw new TagParseError('Root of a tag export must be a JSON object or array', filePath);
  }

  const nodes = new Map<string, TagNode>();
  const udtDefs = new Map<string, string>();
  const rootIds = rootObjs.map((obj, i) => buildNode(obj, null, i, nodes, udtDefs, ignoredKeys));

  const detectedVersionHint = detectVersionHint(rootObjs);

  return {
    filePath,
    rootIds,
    nodes,
    udtDefs,
    meta: { detectedVersionHint, hadBom, eol, rootShape },
  };
}

function isJsonObject(v: JsonValue): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function buildNode(
  obj: JsonObject,
  parentId: string | null,
  sourceIndex: number,
  nodes: Map<string, TagNode>,
  udtDefs: Map<string, string>,
  ignoredKeys: ReadonlySet<string>,
): string {
  const name = typeof obj.name === 'string' ? obj.name : `__unnamed_${sourceIndex}`;
  // NOT `parentId ? ... : name` — a real Ignition Provider export commonly
  // has `"name": ""` at the root, and "" is a legitimate (if unusual) id.
  // Truthiness would treat that empty-string root the same as "no parent",
  // corrupting every direct child's id.
  const baseId = parentId !== null ? `${parentId}/${name}` : name;

  // Malformed exports can contain duplicate sibling names; never silently
  // drop a node over it (PLAN.md §8) — suffix to keep both, and a later
  // validation pass (Phase 3) surfaces this as an error.
  let id = baseId;
  let suffix = 1;
  while (nodes.has(id)) {
    id = `${baseId}#${suffix++}`;
  }

  const tagType = typeof obj.tagType === 'string' ? obj.tagType : undefined;
  const kind = classifyKind(tagType);
  const typeId = typeof obj.typeId === 'string' ? obj.typeId : undefined;

  const hadTagsArray = Array.isArray(obj.tags);
  const childrenRaw = hadTagsArray ? (obj.tags as JsonValue[]).filter(isJsonObject) : [];

  // Keep `raw` as close to the original object as possible: same keys, same
  // key ORDER. We only ever swap the *value* of an existing "tags" key to a
  // placeholder — reassigning an existing key's value does not move its
  // position in JS object key order, so re-serializing an unmodified node
  // reproduces the exact original key order. See serialize.ts.
  const raw: JsonObject = { ...obj };
  if (hadTagsArray) {
    raw.tags = [];
  }

  const childIds = childrenRaw.map((child, i) => buildNode(child, id, i, nodes, udtDefs, ignoredKeys));

  const childHashesByName: Array<readonly [string, string]> = childIds.map((cid) => {
    const c = nodes.get(cid)!;
    return [c.name, c.structuralHash] as const;
  });

  // Built with conditional spreads (rather than `tagType, typeId` directly)
  // so that an absent tagType/typeId OMITS the key entirely instead of
  // setting it to `undefined` — required by exactOptionalPropertyTypes.
  const node: TagNode = {
    id,
    name,
    kind,
    ...(tagType !== undefined ? { tagType } : {}),
    ...(typeId !== undefined ? { typeId } : {}),
    raw,
    childIds,
    ownHash: computeOwnHash(raw, ignoredKeys),
    structuralHash: computeNodeHash(raw, childHashesByName, ignoredKeys),
    sourceIndex,
    parentId,
  };
  nodes.set(id, node);

  if (kind === 'udt-def' && !udtDefs.has(name)) {
    udtDefs.set(name, id);
  }

  return id;
}

export function classifyKind(tagType: string | undefined): NodeKind {
  switch (tagType) {
    case 'Provider':
      return 'provider';
    case 'Folder':
      return 'folder';
    case 'UdtType':
      return 'udt-def';
    case 'UdtInstance':
      return 'udt-instance';
    case undefined:
      return 'unknown';
    default:
      // AtomicTag, OPC/OPCTag, memory, Query, Expression, Derived, etc.
      return 'tag';
  }
}

/**
 * Best-effort 8.1 vs 8.3 export heuristic. Deliberately conservative: with
 * no confirmed structural signal yet (needs real fixtures — PLAN.md §8), this
 * always returns 'unknown' rather than guessing. Once fixtures are in hand
 * (Phase 0), replace the body with an actual signal and keep the signature.
 */
function detectVersionHint(_rootObjs: JsonObject[]): TagFileMeta['detectedVersionHint'] {
  return 'unknown';
}
