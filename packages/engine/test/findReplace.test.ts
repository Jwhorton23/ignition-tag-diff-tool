import { describe, expect, it } from 'vitest';
import { applyFindReplace, parseTagFile, previewFindReplace, serializeTagFile } from '../src/index.js';

function file(obj: unknown) {
  return parseTagFile(JSON.stringify(obj), 'test.json');
}

describe('previewFindReplace', () => {
  it('finds every node whose targeted property contains a literal match, case-insensitive by default', () => {
    const f = file({
      name: 'root',
      tagType: 'Folder',
      tags: [
        { name: 'A', tagType: 'AtomicTag', opcItemPath: 'ns=2;s=[DEV_PLC01]Motor.Speed' },
        { name: 'B', tagType: 'AtomicTag', opcItemPath: 'ns=2;s=[dev_plc02]Motor.Speed' },
        { name: 'C', tagType: 'AtomicTag', opcItemPath: 'ns=2;s=[PROD_PLC01]Motor.Speed' },
      ],
    });
    const changes = previewFindReplace(f, { property: 'opcItemPath', find: 'DEV_', replace: 'PROD_', regex: false, caseSensitive: false });
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.after).sort()).toEqual(['ns=2;s=[PROD_PLC01]Motor.Speed', 'ns=2;s=[PROD_plc02]Motor.Speed']);
  });

  it('respects caseSensitive: true', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', opcItemPath: 'DEV_x' }, { name: 'B', tagType: 'AtomicTag', opcItemPath: 'dev_x' }] });
    const changes = previewFindReplace(f, { property: 'opcItemPath', find: 'DEV_', replace: 'PROD_', regex: false, caseSensitive: true });
    expect(changes).toEqual([{ path: 'root/A', property: 'opcItemPath', before: 'DEV_x', after: 'PROD_x' }]);
  });

  it('supports regex mode with capture groups', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', opcServer: 'PLC-01' }] });
    const changes = previewFindReplace(f, { property: 'opcServer', find: 'PLC-(\\d+)', replace: 'Gateway-$1', regex: true, caseSensitive: true });
    expect(changes).toEqual([{ path: 'root/A', property: 'opcServer', before: 'PLC-01', after: 'Gateway-01' }]);
  });

  it('throws a clear error for an invalid regex instead of silently matching nothing', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [] });
    expect(() => previewFindReplace(f, { property: 'x', find: '(unterminated', replace: '', regex: true, caseSensitive: true })).toThrow(/Invalid regular expression/);
  });

  it('ignores nodes where the property is absent or not a string', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', dataType: 'Int4' }, { name: 'B', tagType: 'Folder', tags: [] }] });
    const changes = previewFindReplace(f, { property: 'opcItemPath', find: 'x', replace: 'y', regex: false, caseSensitive: false });
    expect(changes).toEqual([]);
  });

  it('returns no changes for an empty find string (guards against a nonsensical replace-everywhere)', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', opcItemPath: 'x' }] });
    expect(previewFindReplace(f, { property: 'opcItemPath', find: '', replace: 'y', regex: false, caseSensitive: false })).toEqual([]);
  });
});

describe('applyFindReplace', () => {
  it('applies only the given changes, leaving everything else — including unselected matches — untouched', () => {
    const f = file({
      name: 'root',
      tagType: 'Folder',
      tags: [
        { name: 'A', tagType: 'AtomicTag', opcItemPath: 'DEV_a', engUnit: 'PSI' },
        { name: 'B', tagType: 'AtomicTag', opcItemPath: 'DEV_b' },
      ],
    });
    const allChanges = previewFindReplace(f, { property: 'opcItemPath', find: 'DEV_', replace: 'PROD_', regex: false, caseSensitive: false });
    expect(allChanges).toHaveLength(2);

    // Per-row opt-out: only apply the change for A, not B.
    const selected = allChanges.filter((c) => c.path === 'root/A');
    const result = applyFindReplace(f, selected);
    expect(result.nodes.get('root/A')?.raw.opcItemPath).toBe('PROD_a');
    expect(result.nodes.get('root/A')?.raw.engUnit).toBe('PSI'); // untouched sibling property
    expect(result.nodes.get('root/B')?.raw.opcItemPath).toBe('DEV_b'); // not selected — untouched
  });

  it('does not mutate the source file', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', opcItemPath: 'DEV_a' }] });
    const changes = previewFindReplace(f, { property: 'opcItemPath', find: 'DEV_', replace: 'PROD_', regex: false, caseSensitive: false });
    applyFindReplace(f, changes);
    expect(f.nodes.get('root/A')?.raw.opcItemPath).toBe('DEV_a');
  });

  it('round-trips cleanly through serialize', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', opcItemPath: 'DEV_a', documentation: 'keep me' }] });
    const changes = previewFindReplace(f, { property: 'opcItemPath', find: 'DEV_', replace: 'PROD_', regex: false, caseSensitive: false });
    const result = applyFindReplace(f, changes);
    const parsed = JSON.parse(serializeTagFile(result));
    expect(parsed.tags[0].opcItemPath).toBe('PROD_a');
    expect(parsed.tags[0].documentation).toBe('keep me');
  });
});
