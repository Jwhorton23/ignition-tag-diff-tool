import { describe, expect, it } from 'vitest';
import { extractSubtree, parseTagFile, serializeTagFile } from '../src/index.js';

describe('extractSubtree', () => {
  const file = parseTagFile(
    JSON.stringify({
      name: 'default',
      tagType: 'Provider',
      tags: [
        { name: '_types_', tagType: 'Folder', tags: [{ name: 'MotorBase', tagType: 'UdtType', tags: [] }] },
        {
          name: 'Area1',
          tagType: 'Folder',
          tags: [{ name: 'Line3', tagType: 'Folder', tags: [{ name: 'Speed', tagType: 'AtomicTag', dataType: 'Float8' }] }],
        },
      ],
    }),
    'test.json',
  );

  it('keeps only the chosen node and its descendants', () => {
    const sub = extractSubtree(file, 'default/Area1/Line3');
    expect([...sub.nodes.keys()].sort()).toEqual(['default/Area1/Line3', 'default/Area1/Line3/Speed']);
    expect(sub.rootIds).toEqual(['default/Area1/Line3']);
    expect(sub.meta.rootShape).toBe('single-node');
  });

  it('drops UDT definitions that fall outside the extracted subtree', () => {
    const sub = extractSubtree(file, 'default/Area1');
    expect(sub.udtDefs.has('MotorBase')).toBe(false);
  });

  it('serializes as a valid standalone import rooted at the chosen folder', () => {
    const sub = extractSubtree(file, 'default/Area1/Line3');
    const text = serializeTagFile(sub);
    const parsed = JSON.parse(text);
    expect(parsed.name).toBe('Line3');
    expect(parsed.tagType).toBe('Folder');
    expect(parsed.tags).toEqual([{ name: 'Speed', tagType: 'AtomicTag', dataType: 'Float8' }]);
  });

  it('throws for a path that does not exist', () => {
    expect(() => extractSubtree(file, 'default/NoSuchPath')).toThrow();
  });
});
