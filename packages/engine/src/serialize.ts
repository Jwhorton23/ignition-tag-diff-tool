// Reconstructs a JSON string from a TagFile, byte-for-byte identical to the
// original input for any node that wasn't touched. See PLAN.md §2.1, §4.4.

import type { JsonObject, TagFile, TagNode } from './types.js';

export function serializeTagFile(file: TagFile): string {
  const { rootIds, nodes, meta } = file;
  const rootValues = rootIds.map((id) => nodeToJson(id, nodes));

  const body =
    meta.rootShape === 'folder-array' ? JSON.stringify(rootValues, null, 2) : JSON.stringify(rootValues[0], null, 2);

  // JSON.stringify never emits a raw newline byte for a newline *inside* a
  // string value (it escapes it as the two characters \ and n); the only
  // literal 0x0A bytes in `body` are pretty-printer indentation. Safe to
  // blanket-convert those to CRLF to match the source file's line endings.
  const withEol = meta.eol === 'crlf' ? body.replace(/\n/g, '\r\n') : body;

  return meta.hadBom ? "\uFEFF" + withEol : withEol;
}

function nodeToJson(id: string, nodes: Map<string, TagNode>): JsonObject {
  const node = nodes.get(id);
  if (!node) {
    throw new Error(`serializeTagFile: dangling node id "${id}" (not present in the node map)`);
  }

  const out: JsonObject = { ...node.raw };

  if (node.childIds.length > 0) {
    const children = node.childIds
      .map((cid) => nodes.get(cid))
      .filter((c): c is TagNode => c !== undefined)
      .slice()
      .sort((a, b) => a.sourceIndex - b.sourceIndex);
    // Overwrites the existing placeholder value in place (see parse.ts) when
    // the node originally had a "tags" key, preserving its original
    // position in key order. Appends a new "tags" key only for nodes that
    // gained children they didn't originally have (e.g. after a merge).
    out.tags = children.map((c) => nodeToJson(c.id, nodes));
  }

  return out;
}
