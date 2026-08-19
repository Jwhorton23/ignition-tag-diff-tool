import { describe, expect, it } from 'vitest';
import { parseTagFile } from '../src/index.js';

describe('parseTagFile — node classification and indexing', () => {
  const sample = JSON.stringify({
    name: 'default',
    tagType: 'Provider',
    tags: [
      {
        name: '_types_',
        tagType: 'Folder',
        tags: [{ name: 'MotorBase', tagType: 'UdtType', tags: [{ name: 'Speed', tagType: 'AtomicTag' }] }],
      },
      {
        name: 'Area1',
        tagType: 'Folder',
        tags: [
          { name: 'Motor1', tagType: 'UdtInstance', typeId: 'MotorBase' },
          { name: 'Setpoint', tagType: 'AtomicTag', dataType: 'Float8' },
        ],
      },
    ],
  });

  it('classifies node kinds correctly', () => {
    const file = parseTagFile(sample, 'test.json');
    expect(file.nodes.get('default')?.kind).toBe('provider');
    expect(file.nodes.get('default/_types_')?.kind).toBe('folder');
    expect(file.nodes.get('default/_types_/MotorBase')?.kind).toBe('udt-def');
    expect(file.nodes.get('default/Area1/Motor1')?.kind).toBe('udt-instance');
    expect(file.nodes.get('default/Area1/Setpoint')?.kind).toBe('tag');
  });

  it('builds canonical "/"-joined path ids from the file root', () => {
    const file = parseTagFile(sample, 'test.json');
    expect(file.rootIds).toEqual(['default']);
    expect([...file.nodes.keys()]).toContain('default/Area1/Motor1');
  });

  it('registers UDT definitions by name in udtDefs', () => {
    const file = parseTagFile(sample, 'test.json');
    expect(file.udtDefs.get('MotorBase')).toBe('default/_types_/MotorBase');
  });

  it('detects the root shape (provider vs folder-array vs single-node)', () => {
    expect(parseTagFile(sample, 'test.json').meta.rootShape).toBe('provider');

    const folderArray = JSON.stringify([{ name: 'A', tagType: 'AtomicTag' }, { name: 'B', tagType: 'AtomicTag' }]);
    expect(parseTagFile(folderArray, 'test.json').meta.rootShape).toBe('folder-array');

    const singleNode = JSON.stringify({ name: 'JustAFolder', tagType: 'Folder', tags: [] });
    expect(parseTagFile(singleNode, 'test.json').meta.rootShape).toBe('single-node');
  });

  it('suffixes duplicate sibling names instead of dropping nodes', () => {
    const dup = JSON.stringify({
      name: 'root',
      tagType: 'Folder',
      tags: [
        { name: 'Dup', tagType: 'AtomicTag', dataType: 'Int4' },
        { name: 'Dup', tagType: 'AtomicTag', dataType: 'Float8' },
      ],
    });
    const file = parseTagFile(dup, 'test.json');
    expect(file.nodes.has('root/Dup')).toBe(true);
    expect(file.nodes.has('root/Dup#1')).toBe(true);
    expect(file.nodes.size).toBe(3); // root + two duplicates
  });

  it('throws TagParseError with the file path on invalid JSON', () => {
    expect(() => parseTagFile('{ not valid json', 'broken.json')).toThrowError(/broken\.json/);
  });

  it('throws on a root that is neither an object nor an array', () => {
    expect(() => parseTagFile('"just a string"', 'bad-root.json')).toThrow();
  });
});
