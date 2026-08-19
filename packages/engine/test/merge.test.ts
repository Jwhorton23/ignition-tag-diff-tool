import { describe, expect, it } from 'vitest';
import {
  applyMergePlan,
  buildMergePlan,
  diffTagFiles,
  findMissingUdtDefs,
  parseTagFile,
  pullInUdtDefs,
  serializeTagFile,
  type BuildMergePlanInput,
} from '../src/index.js';
import { assertOrderedEqual } from './orderedEqual.js';

function file(obj: unknown, label: string) {
  return parseTagFile(JSON.stringify(obj), label);
}

const untouchedSibling = { name: 'Untouched', tagType: 'AtomicTag', dataType: 'Int4', opcItemPath: 'ns=2;s=Keep', documentation: 'do not touch' };

describe('buildMergePlan + applyMergePlan — into-a / into-b', () => {
  it('pulls an added (B-only) tag into A when direction is into-a', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [untouchedSibling] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [untouchedSibling, { name: 'NewTag', tagType: 'AtomicTag', dataType: 'Float8' }] }, 'b');
    const diff = diffTagFiles(a, b);

    const plan = buildMergePlan({
      diffIndex: diff,
      selection: new Set(['R0/NewTag']),
      resolutions: new Map(),
      direction: 'into-a',
      mirrorDeletions: false,
    });
    expect(plan.ops).toEqual([{ op: 'add', path: 'R0/NewTag', from: 'b' }]);

    const { file: result, missingUdtDefs } = applyMergePlan(a, b, plan);
    expect(missingUdtDefs).toEqual([]);
    expect(result.nodes.get('R0/NewTag')?.raw.dataType).toBe('Float8');
    // Untouched sibling must be byte-identical to A's original.
    expect(result.nodes.get('R0/Untouched')?.raw).toEqual(a.nodes.get('root/Untouched')?.raw);
  });

  it('does not touch anything when an added tag is left unselected', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [untouchedSibling] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [untouchedSibling, { name: 'NewTag', tagType: 'AtomicTag' }] }, 'b');
    const diff = diffTagFiles(a, b);
    const plan = buildMergePlan({ diffIndex: diff, selection: new Set(), resolutions: new Map(), direction: 'into-a', mirrorDeletions: false });
    expect(plan.ops).toEqual([]);
    const { file: result } = applyMergePlan(a, b, plan);
    expect(result.nodes.has('R0/NewTag')).toBe(false);
  });

  it('leaves a removed (A-only) tag in place by default, and only removes it when mirrorDeletions is on', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [untouchedSibling, { name: 'Stale', tagType: 'AtomicTag' }] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [untouchedSibling] }, 'b');
    const diff = diffTagFiles(a, b);

    const kept = buildMergePlan({ diffIndex: diff, selection: new Set(['R0/Stale']), resolutions: new Map(), direction: 'into-a', mirrorDeletions: false });
    expect(kept.ops).toEqual([]);
    expect(applyMergePlan(a, b, kept).file.nodes.has('R0/Stale')).toBe(true);

    const mirrored = buildMergePlan({ diffIndex: diff, selection: new Set(['R0/Stale']), resolutions: new Map(), direction: 'into-a', mirrorDeletions: true });
    expect(mirrored.ops).toEqual([{ op: 'remove', path: 'R0/Stale' }]);
    expect(applyMergePlan(a, b, mirrored).file.nodes.has('R0/Stale')).toBe(false);
  });

  it('brings a removed (A-only) tag INTO B when merging into-b (the symmetric case)', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [untouchedSibling, { name: 'OnlyInA', tagType: 'AtomicTag', dataType: 'Boolean' }] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [untouchedSibling] }, 'b');
    const diff = diffTagFiles(a, b);
    const plan = buildMergePlan({ diffIndex: diff, selection: new Set(['R0/OnlyInA']), resolutions: new Map(), direction: 'into-b', mirrorDeletions: false });
    expect(plan.ops).toEqual([{ op: 'add', path: 'R0/OnlyInA', from: 'a' }]);
    const { file: result } = applyMergePlan(a, b, plan);
    expect(result.nodes.get('R0/OnlyInA')?.raw.dataType).toBe('Boolean');
  });

  it('resolves a modified conflict with Take-B via a replace op, and leaves base untouched on Take-A', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', opcItemPath: 'ns=2;s=Dev' }] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', opcItemPath: 'ns=2;s=Prod' }] }, 'b');
    const diff = diffTagFiles(a, b);

    const takeB = buildMergePlan({ diffIndex: diff, selection: new Set(['R0/X']), resolutions: new Map([['R0/X', 'b']]), direction: 'into-a', mirrorDeletions: false });
    expect(takeB.ops).toEqual([{ op: 'replace', path: 'R0/X', from: 'b' }]);
    expect(applyMergePlan(a, b, takeB).file.nodes.get('R0/X')?.raw.opcItemPath).toBe('ns=2;s=Prod');

    const takeA = buildMergePlan({ diffIndex: diff, selection: new Set(['R0/X']), resolutions: new Map([['R0/X', 'a']]), direction: 'into-a', mirrorDeletions: false });
    expect(takeA.ops).toEqual([]); // resolving to the side that's already the base is a no-op
    expect(applyMergePlan(a, b, takeA).file.nodes.get('R0/X')?.raw.opcItemPath).toBe('ns=2;s=Dev');
  });

  it('brings the whole subtree along when a folder-level add is selected', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [] }, 'a');
    const b = file(
      { name: 'root', tagType: 'Folder', tags: [{ name: 'NewFolder', tagType: 'Folder', tags: [{ name: 'Child1', tagType: 'AtomicTag' }, { name: 'Child2', tagType: 'AtomicTag' }] }] },
      'b',
    );
    const diff = diffTagFiles(a, b);
    const plan = buildMergePlan({ diffIndex: diff, selection: new Set(['R0/NewFolder']), resolutions: new Map(), direction: 'into-a', mirrorDeletions: false });
    const { file: result } = applyMergePlan(a, b, plan);
    expect(result.nodes.has('R0/NewFolder/Child1')).toBe(true);
    expect(result.nodes.has('R0/NewFolder/Child2')).toBe(true);
    expect(result.nodes.get('R0/NewFolder')?.childIds.sort()).toEqual(['R0/NewFolder/Child1', 'R0/NewFolder/Child2']);
  });

  it('round-trips the merge result through serialize/parse with the untouched sibling byte-identical', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [untouchedSibling] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [untouchedSibling, { name: 'NewTag', tagType: 'AtomicTag', dataType: 'Float8' }] }, 'b');
    const diff = diffTagFiles(a, b);
    const plan = buildMergePlan({ diffIndex: diff, selection: new Set(['R0/NewTag']), resolutions: new Map(), direction: 'into-a', mirrorDeletions: false });
    const { file: result } = applyMergePlan(a, b, plan);
    const serialized = serializeTagFile(result);
    const reparsed = JSON.parse(serialized);
    const originalUntouched = JSON.parse(JSON.stringify(untouchedSibling));
    const mergedUntouched = reparsed.tags.find((t: { name: string }) => t.name === 'Untouched');
    assertOrderedEqual(mergedUntouched, originalUntouched);
  });
});

describe('buildMergePlan + applyMergePlan — new-file', () => {
  it('builds a minimal tree containing only the selected subtrees, synthesizing bare ancestor folders', () => {
    const a = file({ name: 'default', tagType: 'Provider', tags: [{ name: 'Area1', tagType: 'Folder', tags: [{ name: 'Line3', tagType: 'Folder', tags: [{ name: 'Speed', tagType: 'AtomicTag', dataType: 'Float8' }] }] }] }, 'a');
    const b = file({ name: 'default', tagType: 'Provider', tags: [] }, 'b');
    const diff = diffTagFiles(a, b);

    const plan = buildMergePlan({
      diffIndex: diff,
      selection: new Set(['R0/Area1/Line3/Speed']),
      resolutions: new Map(),
      direction: 'new-file',
      mirrorDeletions: false,
    });
    expect(plan.ops).toEqual([{ op: 'add', path: 'R0/Area1/Line3/Speed', from: 'a' }]);

    const { file: result } = applyMergePlan(a, b, plan);
    expect(result.nodes.get('R0/Area1/Line3/Speed')?.raw.dataType).toBe('Float8');
    // Ancestors were synthesized as bare folders, not copied from A's real (nonexistent) folder raw.
    expect(result.nodes.get('R0/Area1')?.raw.tagType).toBe('Folder');
    expect(result.rootIds).toEqual(['R0']);
    expect(result.meta.hadBom).toBe(false);
    expect(result.meta.eol).toBe('lf');
  });
});

describe('UDT dependency safety (missing definitions)', () => {
  function scenario() {
    const typesFolder = { name: '_types_', tagType: 'Folder', tags: [{ name: 'MotorBase', tagType: 'UdtType', tags: [{ name: 'Speed', tagType: 'AtomicTag' }] }] };
    const a = file({ name: 'default', tagType: 'Provider', tags: [] }, 'a'); // no _types_ at all
    const b = file({ name: 'default', tagType: 'Provider', tags: [typesFolder, { name: 'Area1', tagType: 'Folder', tags: [{ name: 'Motor1', tagType: 'UdtInstance', typeId: 'MotorBase' }] }] }, 'b');
    return { a, b, diff: diffTagFiles(a, b) };
  }

  it('flags a UDT instance whose definition was not pulled in', () => {
    const { a, b, diff } = scenario();
    const plan = buildMergePlan({ diffIndex: diff, selection: new Set(['R0/Area1/Motor1']), resolutions: new Map(), direction: 'into-a', mirrorDeletions: false });
    const { file: result, missingUdtDefs } = applyMergePlan(a, b, plan);
    expect(missingUdtDefs).toEqual([{ instancePath: 'R0/Area1/Motor1', typeId: 'MotorBase' }]);
    expect(findMissingUdtDefs(result)).toEqual(missingUdtDefs);
  });

  it('pullInUdtDefs resolves the gap by adding the missing definition', () => {
    const { a, b, diff } = scenario();
    let plan = buildMergePlan({ diffIndex: diff, selection: new Set(['R0/Area1/Motor1']), resolutions: new Map(), direction: 'into-a', mirrorDeletions: false });
    let applied = applyMergePlan(a, b, plan);
    expect(applied.missingUdtDefs).toHaveLength(1);

    plan = pullInUdtDefs(a, b, plan, applied.missingUdtDefs);
    applied = applyMergePlan(a, b, plan);
    expect(applied.missingUdtDefs).toEqual([]);
    expect(applied.file.udtDefs.has('MotorBase')).toBe(true);
  });
});

describe('patch op (cherry-pick apply — not yet emitted by buildMergePlan, but must apply correctly)', () => {
  it('overwrites only the listed top-level properties, leaving the rest of the base node untouched', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', opcItemPath: 'ns=2;s=Dev', engUnit: 'PSI', documentation: 'keep me' }] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', opcItemPath: 'ns=2;s=Prod', engUnit: 'BAR', documentation: 'ignore me' }] }, 'b');
    const diff = diffTagFiles(a, b);
    const input: BuildMergePlanInput = { diffIndex: diff, selection: new Set(), resolutions: new Map(), direction: 'into-a', mirrorDeletions: false };
    const plan = { ...buildMergePlan(input), ops: [{ op: 'patch' as const, path: 'R0/X', props: [{ key: 'opcItemPath', from: 'b' as const }] }] };
    const { file: result } = applyMergePlan(a, b, plan);
    const raw = result.nodes.get('R0/X')?.raw;
    expect(raw?.opcItemPath).toBe('ns=2;s=Prod');
    expect(raw?.engUnit).toBe('PSI'); // untouched — stayed A's value
    expect(raw?.documentation).toBe('keep me'); // untouched
  });
});
