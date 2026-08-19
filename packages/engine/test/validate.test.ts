import { describe, expect, it } from 'vitest';
import { parseTagFile, validateTagFile } from '../src/index.js';

function file(obj: unknown) {
  return parseTagFile(JSON.stringify(obj), 'test.json');
}

describe('validateTagFile — case-collision duplicate paths', () => {
  it('flags two siblings that differ only by case', () => {
    const f = file({
      name: 'root',
      tagType: 'Folder',
      tags: [
        { name: 'Motor1', tagType: 'AtomicTag' },
        { name: 'motor1', tagType: 'AtomicTag' },
      ],
    });
    const issues = validateTagFile(f);
    const collisions = issues.filter((i) => i.kind === 'duplicate-path');
    expect(collisions).toHaveLength(2); // one issue per colliding sibling
    expect(collisions.every((i) => i.severity === 'error')).toBe(true);
    expect(collisions.map((i) => i.path).sort()).toEqual(['root/Motor1', 'root/motor1']);
  });

  it('does not flag siblings with distinct names, or same-named nodes in different folders', () => {
    const f = file({
      name: 'root',
      tagType: 'Folder',
      tags: [
        { name: 'A', tagType: 'Folder', tags: [{ name: 'Shared', tagType: 'AtomicTag' }] },
        { name: 'B', tagType: 'Folder', tags: [{ name: 'Shared', tagType: 'AtomicTag' }] },
      ],
    });
    expect(validateTagFile(f).filter((i) => i.kind === 'duplicate-path')).toEqual([]);
  });
});

describe('validateTagFile — missing UDT definitions', () => {
  it('flags a UDT instance whose type has no definition in the file', () => {
    const f = file({
      name: 'root',
      tagType: 'Folder',
      tags: [{ name: 'Motor1', tagType: 'UdtInstance', typeId: 'MotorBase' }],
    });
    const issues = validateTagFile(f).filter((i) => i.kind === 'missing-udt-def');
    expect(issues).toEqual([
      { severity: 'error', kind: 'missing-udt-def', path: 'root/Motor1', message: expect.stringContaining('MotorBase') },
    ]);
  });

  it('does not flag an instance whose definition is present', () => {
    const f = file({
      name: 'root',
      tagType: 'Folder',
      tags: [
        { name: '_types_', tagType: 'Folder', tags: [{ name: 'MotorBase', tagType: 'UdtType', tags: [] }] },
        { name: 'Motor1', tagType: 'UdtInstance', typeId: 'MotorBase' },
      ],
    });
    expect(validateTagFile(f).filter((i) => i.kind === 'missing-udt-def')).toEqual([]);
  });
});

describe('validateTagFile — dangling parameter bindings', () => {
  function scenario(instanceParams: Record<string, string>) {
    return file({
      name: 'root',
      tagType: 'Folder',
      tags: [
        {
          name: '_types_',
          tagType: 'Folder',
          tags: [
            {
              name: 'MotorBase',
              tagType: 'UdtType',
              parameters: { InstanceName: { dataType: 'String' }, PLCInstance: { dataType: 'String' } },
              tags: [{ name: 'Speed', tagType: 'AtomicTag', opcItemPath: 'ns=2;s=[{PLCInstance}]Motors.{InstanceName}.Speed' }],
            },
          ],
        },
        { name: 'Motor1', tagType: 'UdtInstance', typeId: 'MotorBase', parameters: instanceParams },
      ],
    });
  }

  it('flags a declared parameter with no value provided by the instance', () => {
    const f = scenario({ InstanceName: 'Motor1' }); // PLCInstance missing
    const issues = validateTagFile(f).filter((i) => i.kind === 'dangling-param-binding');
    expect(issues.some((i) => i.path === 'root/Motor1' && i.message.includes('PLCInstance'))).toBe(true);
  });

  it('flags a {ref} in a descendant tag that is not a declared or provided parameter (typo)', () => {
    const f = file({
      name: 'root',
      tagType: 'Folder',
      tags: [
        {
          name: '_types_',
          tagType: 'Folder',
          tags: [
            {
              name: 'MotorBase',
              tagType: 'UdtType',
              parameters: { InstanceName: { dataType: 'String' } },
              tags: [{ name: 'Speed', tagType: 'AtomicTag', opcItemPath: 'ns=2;s={InstanceNmae}.Speed' }], // typo: InstanceNmae
            },
          ],
        },
        { name: 'Motor1', tagType: 'UdtInstance', typeId: 'MotorBase', parameters: { InstanceName: 'Motor1' } },
      ],
    });
    const issues = validateTagFile(f).filter((i) => i.kind === 'dangling-param-binding');
    expect(issues.some((i) => i.message.includes('InstanceNmae'))).toBe(true);
  });

  it('reports no dangling bindings when every declared parameter is provided and every {ref} is valid', () => {
    const f = scenario({ InstanceName: 'Motor1', PLCInstance: 'PLC01' });
    expect(validateTagFile(f).filter((i) => i.kind === 'dangling-param-binding')).toEqual([]);
  });
});
