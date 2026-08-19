// Validation pass (PLAN.md §5): duplicate paths (case-collisions Ignition
// would itself reject on import), UDT instances missing their definition,
// and dangling {param} bindings. Runs on load and pre-export; results are
// meant for a click-to-navigate panel in the UI.

import type { JsonObject, JsonValue, TagFile, ValidationIssue } from './types.js';
import { findMissingUdtDefs } from './merge.js';

function isPlainObject(v: JsonValue | undefined): v is JsonObject {
  return v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);
}

export function validateTagFile(file: TagFile): ValidationIssue[] {
  return [...findCaseCollisions(file), ...findMissingDefs(file), ...findDanglingParamBindings(file)];
}

/** Ignition tag paths are case-insensitive, so two siblings differing only
 *  by case (e.g. "Motor1" / "motor1") will collide on import even though
 *  this tool's own alignment treats them as distinct nodes. */
function findCaseCollisions(file: TagFile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byParent = new Map<string | null, string[]>();
  for (const [id, node] of file.nodes) {
    if (!byParent.has(node.parentId)) byParent.set(node.parentId, []);
    byParent.get(node.parentId)!.push(id);
  }

  for (const siblingIds of byParent.values()) {
    const byLowerName = new Map<string, string[]>();
    for (const id of siblingIds) {
      const name = file.nodes.get(id)!.name.toLowerCase();
      if (!byLowerName.has(name)) byLowerName.set(name, []);
      byLowerName.get(name)!.push(id);
    }
    for (const group of byLowerName.values()) {
      if (group.length < 2) continue;
      for (const id of group) {
        const others = group.filter((g) => g !== id);
        issues.push({
          severity: 'error',
          kind: 'duplicate-path',
          path: id,
          message: `Name collides case-insensitively with sibling(s): ${others.map((o) => file.nodes.get(o)!.name).join(', ')} — Ignition treats tag paths as case-insensitive and will collide on import.`,
          relatedPaths: others,
        });
      }
    }
  }
  return issues;
}

function findMissingDefs(file: TagFile): ValidationIssue[] {
  return findMissingUdtDefs(file).map((m) => ({
    severity: 'error' as const,
    kind: 'missing-udt-def' as const,
    path: m.instancePath,
    message: `References UDT type "${m.typeId}", which has no definition in this file.`,
  }));
}

/** Two checks, because real Ignition UDTs split parameter usage across two
 *  places: the {Name} *placeholders* (e.g. in an opcItemPath template) live
 *  on the UDT DEFINITION's own member tags, while each INSTANCE just
 *  supplies the *values* (and only occasionally overrides a member tag with
 *  its own placeholder-bearing property). So:
 *  1. Per UDT definition (once, not once per instance): every {Name} found
 *     anywhere in the definition's own subtree must be one of its declared
 *     parameters.
 *  2. Per instance: every declared parameter must have a provided value,
 *     and any {Name} within the instance's own override subtree must be
 *     declared-or-provided. */
function findDanglingParamBindings(file: TagFile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [typeId, defId] of file.udtDefs) {
    const defNode = file.nodes.get(defId);
    if (!defNode) continue;
    const declaredParams = isPlainObject(defNode.raw.parameters) ? Object.keys(defNode.raw.parameters) : [];
    const validNames = new Set(declaredParams);
    for (const descId of subtreeIds(file, defId)) {
      scanForDanglingRefs(file, descId, validNames, typeId, issues);
    }
  }

  for (const [id, node] of file.nodes) {
    if (node.kind !== 'udt-instance' || !node.typeId) continue;
    const defId = file.udtDefs.get(node.typeId);
    const defNode = defId !== undefined ? file.nodes.get(defId) : undefined;
    const declaredParams = defNode && isPlainObject(defNode.raw.parameters) ? Object.keys(defNode.raw.parameters) : [];
    const instanceParams = isPlainObject(node.raw.parameters) ? Object.keys(node.raw.parameters) : [];
    const providedSet = new Set(instanceParams);

    for (const p of declaredParams) {
      if (!providedSet.has(p)) {
        issues.push({
          severity: 'warning',
          kind: 'dangling-param-binding',
          path: id,
          message: `Missing a value for declared parameter "${p}" (defined on UDT "${node.typeId}").`,
        });
      }
    }

    const validNames = new Set([...declaredParams, ...instanceParams]);
    for (const descId of subtreeIds(file, id)) {
      scanForDanglingRefs(file, descId, validNames, node.typeId, issues);
    }
  }
  return issues;
}

function scanForDanglingRefs(file: TagFile, nodeId: string, validNames: ReadonlySet<string>, typeId: string, issues: ValidationIssue[]): void {
  const node = file.nodes.get(nodeId);
  if (!node) return;
  for (const [key, value] of Object.entries(node.raw)) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/\{([^}]+)\}/g)) {
      const refName = match[1]!;
      if (!validNames.has(refName)) {
        issues.push({
          severity: 'warning',
          kind: 'dangling-param-binding',
          path: nodeId,
          message: `"${key}" references "{${refName}}", which is not a declared parameter of "${typeId}".`,
        });
      }
    }
  }
}

function subtreeIds(file: TagFile, rootId: string): string[] {
  const node = file.nodes.get(rootId);
  if (!node) return [];
  const result = [rootId];
  for (const childId of node.childIds) result.push(...subtreeIds(file, childId));
  return result;
}
