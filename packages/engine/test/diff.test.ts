import { describe, expect, it } from 'vitest';
import { diffTagFiles, parseTagFile } from '../src/index.js';

function file(obj: unknown, label: string) {
  return parseTagFile(JSON.stringify(obj), label);
}

describe('diffTagFiles — status classification', () => {
  it('marks a leaf modified but leaves the unchanged ancestor folder unchanged, with rollup carrying the count', () => {
    const a = file({ name: 'default', tagType: 'Provider', tags: [{ name: 'Area1', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', dataType: 'Int4' }] }] }, 'a');
    const b = file({ name: 'default', tagType: 'Provider', tags: [{ name: 'Area1', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', dataType: 'Float8' }] }] }, 'b');
    const diff = diffTagFiles(a, b);

    expect(diff.byPath.get('R0/Area1/X')?.status).toBe('modified');
    expect(diff.byPath.get('R0/Area1')?.status).toBe('unchanged');
    expect(diff.byPath.get('R0/Area1')?.rollup).toEqual({ added: 0, removed: 0, modified: 1, inherited: 0 });
    expect(diff.byPath.get('R0')?.status).toBe('unchanged');
    expect(diff.byPath.get('R0')?.rollup.modified).toBe(1);
  });

  it('classifies a tag only in B as added, only in A as removed', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'OnlyInA', tagType: 'AtomicTag' }] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'OnlyInB', tagType: 'AtomicTag' }] }, 'b');
    const diff = diffTagFiles(a, b);
    expect(diff.byPath.get('R0/OnlyInA')?.status).toBe('removed');
    expect(diff.byPath.get('R0/OnlyInB')?.status).toBe('added');
    expect(diff.byPath.get('R0')?.rollup).toEqual({ added: 1, removed: 1, modified: 0, inherited: 0 });
  });

  it('classifies same path with a different tagType as type-changed, not modified', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'X', tagType: 'Folder', tags: [] }] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', dataType: 'Int4' }] }, 'b');
    const diff = diffTagFiles(a, b);
    expect(diff.byPath.get('R0/X')?.status).toBe('type-changed');
  });

  it('reports unchanged when both sides are byte-for-byte the same', () => {
    const obj = { name: 'root', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', dataType: 'Int4', opcItemPath: 'ns=2;s=A' }] };
    const a = file(obj, 'a');
    const b = file(obj, 'b');
    const diff = diffTagFiles(a, b);
    expect(diff.byPath.get('R0/X')?.status).toBe('unchanged');
    expect(diff.byPath.get('R0')?.rollup).toEqual({ added: 0, removed: 0, modified: 0, inherited: 0 });
  });

  it('ignores default-ignored properties (value/quality/timestamp) when classifying status', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', value: 1, quality: 'Good' }] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', value: 99, quality: 'Bad' }] }, 'b');
    const diff = diffTagFiles(a, b);
    expect(diff.byPath.get('R0/X')?.status).toBe('unchanged');
  });

  it('aligns by path even when the two files use different root/provider names', () => {
    const a = file({ name: 'default', tagType: 'Provider', tags: [{ name: 'Area1', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', dataType: 'Int4' }] }] }, 'a');
    const b = file({ name: 'devTags', tagType: 'Provider', tags: [{ name: 'Area1', tagType: 'Folder', tags: [{ name: 'X', tagType: 'AtomicTag', dataType: 'Float8' }] }] }, 'b');
    const diff = diffTagFiles(a, b);
    expect(diff.byPath.get('R0/Area1/X')?.status).toBe('modified');
    expect(diff.rootPaths).toEqual(['R0']);
  });

  it('flags case-only path differences instead of treating them as unrelated add+remove', () => {
    const a = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'Motor1', tagType: 'AtomicTag', dataType: 'Int4' }] }, 'a');
    const b = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'motor1', tagType: 'AtomicTag', dataType: 'Int4' }] }, 'b');
    const diff = diffTagFiles(a, b);
    const entries = [...diff.byPath.values()].filter((n) => n.parentPath === 'R0');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.caseOnlyRename).toBe(true);
  });
});

describe('diffTagFiles — UDT impact pass', () => {
  function udtScenario(memberDataTypeB: string) {
    const typesFolder = (dataType: string) => ({
      name: '_types_',
      tagType: 'Folder',
      tags: [{ name: 'MotorBase', tagType: 'UdtType', tags: [{ name: 'Speed', tagType: 'AtomicTag', dataType }] }],
    });
    const instance = { name: 'Motor1', tagType: 'UdtInstance', typeId: 'MotorBase' };
    const a = file({ name: 'default', tagType: 'Provider', tags: [typesFolder('Float8'), { name: 'Area1', tagType: 'Folder', tags: [instance] }] }, 'a');
    const b = file({ name: 'default', tagType: 'Provider', tags: [typesFolder(memberDataTypeB), { name: 'Area1', tagType: 'Folder', tags: [instance] }] }, 'b');
    return diffTagFiles(a, b);
  }

  it('flags an unchanged instance as def-changed when its UDT definition differs, and rolls it up as inherited', () => {
    const diff = udtScenario('Float4'); // definition's member changed
    const instanceNode = diff.byPath.get('R0/Area1/Motor1');
    expect(instanceNode?.status).toBe('unchanged'); // instance's own raw (just typeId/name) is identical
    expect(instanceNode?.udtImpact).toBe('def-changed');
    expect(diff.byPath.get('R0/Area1')?.rollup.inherited).toBe(1);
    expect(diff.byPath.get('R0')?.rollup.inherited).toBe(1);
  });

  it('does not flag def-changed when the definition is identical', () => {
    const diff = udtScenario('Float8'); // same as A
    expect(diff.byPath.get('R0/Area1/Motor1')?.udtImpact).toBeUndefined();
  });

  it('propagates a base UDT change to a derived type through the inheritance chain (typeId on the def itself)', () => {
    function build(baseDataType: string) {
      const typesFolder = {
        name: '_types_',
        tagType: 'Folder',
        tags: [
          { name: 'MotorBase', tagType: 'UdtType', tags: [{ name: 'Speed', tagType: 'AtomicTag', dataType: baseDataType }] },
          { name: 'MotorV2', tagType: 'UdtType', typeId: 'MotorBase', tags: [{ name: 'Torque', tagType: 'AtomicTag', dataType: 'Float8' }] },
        ],
      };
      const instance = { name: 'Motor1', tagType: 'UdtInstance', typeId: 'MotorV2' };
      return { name: 'default', tagType: 'Provider', tags: [typesFolder, { name: 'Area1', tagType: 'Folder', tags: [instance] }] };
    }
    const a = file(build('Float8'), 'a');
    const b = file(build('Int4'), 'b'); // base type's member changed, derived type's own tags did not
    const diff = diffTagFiles(a, b);
    expect(diff.byPath.get('R0/Area1/Motor1')?.udtImpact).toBe('def-changed');
  });
});
