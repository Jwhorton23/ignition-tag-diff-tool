// Regression suite for a real bug found against a real gateway export: the
// Provider root commonly has `"name": ""` (empty string). Several places in
// the codebase used `id ? ... : undefined`-style truthiness checks on node
// ids, which incorrectly treat a legitimate empty-string id the same as "no
// id" — silently dropping the root from the diff entirely and producing a
// completely empty tree. Fixed by switching every such check to `!== undefined`
// (or `!== null` for parentId). This suite pins the exact real-world shape
// that exposed it so it can never silently regress.

import { describe, expect, it } from 'vitest';
import { diffTagFiles, parseTagFile } from '../src/index.js';

function providerWithEmptyName(tags: unknown[]) {
  return JSON.stringify({ name: '', tagType: 'Provider', tags });
}

describe('root Provider with an empty-string name (real Ignition export shape)', () => {
  it('parses to a non-empty root id and preserves the tree', () => {
    const file = parseTagFile(
      providerWithEmptyName([{ name: 'ASHEVILLE', tagType: 'Folder', tags: [{ name: 'CASTING', tagType: 'Folder', tags: [] }] }]),
      'qa.json',
    );
    expect(file.rootIds).toEqual(['']);
    expect(file.nodes.has('')).toBe(true);
    // The direct child's id is "/ASHEVILLE" (parentId "" + "/" + name) —
    // cosmetically unusual, but correctly linked: parentId points back at
    // the real empty-string root id, not treated as parentless.
    expect(file.nodes.get('/ASHEVILLE')?.parentId).toBe('');
  });

  it('does NOT drop the root from the diff (the actual reported bug: a fully empty tree)', () => {
    const a = parseTagFile(providerWithEmptyName([{ name: 'ASHEVILLE', tagType: 'Folder', tags: [] }]), 'a.json');
    const b = parseTagFile(providerWithEmptyName([{ name: 'ASHEVILLE', tagType: 'Folder', tags: [] }]), 'b.json');
    const diff = diffTagFiles(a, b);

    // Before the fix: rootPaths was [] and byPath was empty — nothing rendered.
    expect(diff.rootPaths).toEqual(['R0']);
    expect(diff.byPath.size).toBeGreaterThan(0);
    expect(diff.byPath.get('R0')).toBeDefined();
    expect(diff.byPath.get('R0')?.status).toBe('unchanged');
  });

  it('still correctly classifies a real change under an empty-name root', () => {
    const a = parseTagFile(
      providerWithEmptyName([{ name: 'ASHEVILLE', tagType: 'Folder', tags: [{ name: 'Motor_Speed', tagType: 'AtomicTag', dataType: 'Float4' }] }]),
      'a.json',
    );
    const b = parseTagFile(
      providerWithEmptyName([{ name: 'ASHEVILLE', tagType: 'Folder', tags: [{ name: 'Motor_Speed', tagType: 'AtomicTag', dataType: 'Float8' }] }]),
      'b.json',
    );
    const diff = diffTagFiles(a, b);

    expect(diff.byPath.get('R0/ASHEVILLE/Motor_Speed')?.status).toBe('modified');
    expect(diff.byPath.get('R0/ASHEVILLE')?.rollup.modified).toBe(1);
    expect(diff.byPath.get('R0')?.rollup.modified).toBe(1);
    // The root itself stays unchanged (folder's own properties didn't change) —
    // this is the ownHash-vs-structuralHash guarantee, still holding here.
    expect(diff.byPath.get('R0')?.status).toBe('unchanged');
  });

  it('detects an added tag under an empty-name root', () => {
    const a = parseTagFile(providerWithEmptyName([{ name: 'ASHEVILLE', tagType: 'Folder', tags: [] }]), 'a.json');
    const b = parseTagFile(
      providerWithEmptyName([{ name: 'ASHEVILLE', tagType: 'Folder', tags: [{ name: 'NewTag', tagType: 'AtomicTag' }] }]),
      'b.json',
    );
    const diff = diffTagFiles(a, b);
    expect(diff.byPath.get('R0/ASHEVILLE/NewTag')?.status).toBe('added');
  });

  it('reproduces the full real-world nesting depth from the reported example without dropping anything', () => {
    const build = (motorSpeedDataType: string) =>
      providerWithEmptyName([
        {
          name: 'ASHEVILLE',
          tagType: 'Folder',
          tags: [
            {
              name: 'CASTING',
              tagType: 'Folder',
              tags: [
                {
                  name: 'WD10017',
                  tagType: 'Folder',
                  tags: [
                    {
                      name: 'SLURRY MIX',
                      tagType: 'Folder',
                      tags: [
                        {
                          name: '203',
                          tagType: 'Folder',
                          tags: [
                            {
                              name: 'S05',
                              tagType: 'Folder',
                              tags: [
                                {
                                  name: 'WASH BAY',
                                  tagType: 'Folder',
                                  tags: [
                                    { valueSource: 'opc', dataType: motorSpeedDataType, name: 'Motor_Speed', tagType: 'AtomicTag' },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);

    const a = parseTagFile(build('Float4'), 'a.json');
    const b = parseTagFile(build('Float8'), 'b.json');
    const diff = diffTagFiles(a, b);

    const deepPath = 'R0/ASHEVILLE/CASTING/WD10017/SLURRY MIX/203/S05/WASH BAY/Motor_Speed';
    expect(diff.byPath.get(deepPath)?.status).toBe('modified');
    // Every ancestor up the chain should exist and carry the rollup.
    expect(diff.byPath.get('R0')?.rollup.modified).toBe(1);
    expect(diff.byPath.get('R0/ASHEVILLE/CASTING/WD10017/SLURRY MIX/203/S05/WASH BAY')?.rollup.modified).toBe(1);
  });
});
