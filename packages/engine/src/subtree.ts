// Re-roots a TagFile at one of its own nodes, for "export just this folder"
// (PLAN.md §4.4). Reuses the same node ids (alignment paths from a merge
// result, or a file's own ids) — only the root/filtering changes.

import type { TagFile, TagFileMeta } from './types.js';

export function extractSubtree(file: TagFile, rootPath: string): TagFile {
  const rootNode = file.nodes.get(rootPath);
  if (!rootNode) {
    throw new Error(`extractSubtree: no such node "${rootPath}" in this file`);
  }

  const nodes = new Map(file.nodes);
  const prefix = `${rootPath}/`;
  for (const id of file.nodes.keys()) {
    if (id !== rootPath && !id.startsWith(prefix)) {
      nodes.delete(id);
    }
  }
  nodes.set(rootPath, { ...rootNode, parentId: null });

  const udtDefs = new Map<string, string>();
  for (const [name, id] of file.udtDefs) {
    if (nodes.has(id)) udtDefs.set(name, id);
  }

  const rootShape: TagFileMeta['rootShape'] = rootNode.tagType === 'Provider' ? 'provider' : 'single-node';

  return {
    filePath: file.filePath,
    rootIds: [rootPath],
    nodes,
    udtDefs,
    meta: { ...file.meta, rootShape },
  };
}
