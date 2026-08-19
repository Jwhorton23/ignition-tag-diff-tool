import { describe, expect, it } from 'vitest';
import { parseTagFile } from '../src/index.js';
import { DEFAULT_IGNORED_KEYS } from '../src/hash.js';

function tag(extra: Record<string, unknown>) {
  return JSON.stringify({ name: 'root', tagType: 'Folder', tags: [{ name: 'T', tagType: 'AtomicTag', ...extra }] });
}

describe('structural hashing', () => {
  it('is independent of JSON property order', () => {
    const a = parseTagFile(
      JSON.stringify({ name: 'root', tagType: 'Folder', tags: [{ name: 'T', tagType: 'AtomicTag', dataType: 'Int4', opcServer: 'S1' }] }),
      'a.json',
    );
    const b = parseTagFile(
      JSON.stringify({ name: 'root', tagType: 'Folder', tags: [{ opcServer: 'S1', dataType: 'Int4', name: 'T', tagType: 'AtomicTag' }] }),
      'b.json',
    );
    expect(a.nodes.get('root/T')!.structuralHash).toBe(b.nodes.get('root/T')!.structuralHash);
  });

  it('changes when a non-ignored property changes', () => {
    const a = parseTagFile(tag({ opcItemPath: 'ns=2;s=A' }), 'a.json');
    const b = parseTagFile(tag({ opcItemPath: 'ns=2;s=B' }), 'b.json');
    expect(a.nodes.get('root/T')!.structuralHash).not.toBe(b.nodes.get('root/T')!.structuralHash);
  });

  it('is unaffected by default-ignored properties (value/quality/timestamp)', () => {
    expect(DEFAULT_IGNORED_KEYS).toEqual(['value', 'quality', 'timestamp']);
    const a = parseTagFile(tag({ value: 1, quality: 'Good', timestamp: 111 }), 'a.json');
    const b = parseTagFile(tag({ value: 2, quality: 'Bad', timestamp: 222 }), 'b.json');
    expect(a.nodes.get('root/T')!.structuralHash).toBe(b.nodes.get('root/T')!.structuralHash);
  });

  it('is unaffected by reordering children (order-independent by name)', () => {
    const a = parseTagFile(
      JSON.stringify({
        name: 'root',
        tagType: 'Folder',
        tags: [
          { name: 'X', tagType: 'AtomicTag', dataType: 'Int4' },
          { name: 'Y', tagType: 'AtomicTag', dataType: 'Float8' },
        ],
      }),
      'a.json',
    );
    const b = parseTagFile(
      JSON.stringify({
        name: 'root',
        tagType: 'Folder',
        tags: [
          { name: 'Y', tagType: 'AtomicTag', dataType: 'Float8' },
          { name: 'X', tagType: 'AtomicTag', dataType: 'Int4' },
        ],
      }),
      'b.json',
    );
    expect(a.nodes.get('root')!.structuralHash).toBe(b.nodes.get('root')!.structuralHash);
    // But source order (sourceIndex) must still reflect each file's own ordering,
    // since that drives serialization fidelity — reorder-insensitivity is only
    // for the change-detection hash.
    expect(a.nodes.get('root/X')!.sourceIndex).toBe(0);
    expect(b.nodes.get('root/X')!.sourceIndex).toBe(1);
  });

  it('respects a custom ignore-list passed via ParseOptions', () => {
    const a = parseTagFile(tag({ engUnit: 'PSI' }), 'a.json', { ignoredKeys: ['engUnit'] });
    const b = parseTagFile(tag({ engUnit: 'BAR' }), 'b.json', { ignoredKeys: ['engUnit'] });
    expect(a.nodes.get('root/T')!.structuralHash).toBe(b.nodes.get('root/T')!.structuralHash);
  });
});
