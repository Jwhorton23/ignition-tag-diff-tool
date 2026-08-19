import { describe, expect, it } from 'vitest';
import { computePropDiff } from '../src/index.js';

describe('computePropDiff', () => {
  it('reports a changed scalar property', () => {
    const rows = computePropDiff({ opcItemPath: 'ns=2;s=A' }, { opcItemPath: 'ns=2;s=B' }, new Set());
    expect(rows).toEqual([{ key: 'opcItemPath', status: 'changed', ignored: false, renderHint: 'scalar', aValue: 'ns=2;s=A', bValue: 'ns=2;s=B' }]);
  });

  it('marks default-ignored properties as ignored but still reports them', () => {
    const rows = computePropDiff({ value: 1 }, { value: 2 }, new Set(['value']));
    expect(rows).toEqual([{ key: 'value', status: 'changed', ignored: true, renderHint: 'scalar', aValue: 1, bValue: 2 }]);
  });

  it('never reports the "tags" key (children are diffed by the tree diff, not here)', () => {
    const rows = computePropDiff({ name: 'X', tags: [{ name: 'child' }] }, { name: 'Y', tags: [{ name: 'other' }] }, new Set());
    expect(rows.some((r) => r.key === 'tags')).toBe(false);
    expect(rows).toEqual([{ key: 'name', status: 'changed', ignored: false, renderHint: 'scalar', aValue: 'X', bValue: 'Y' }]);
  });

  it('matches alarms by name (identity key), not by array position', () => {
    const a = { alarms: [{ name: 'Hi', setpointA: 90 }, { name: 'Lo', setpointA: 10 }] };
    const b = { alarms: [{ name: 'Lo', setpointA: 10 }, { name: 'Hi', setpointA: 95 }] }; // reordered; only Hi's setpoint actually changed
    const rows = computePropDiff(a, b, new Set());
    expect(rows).toEqual([{ key: 'alarms[Hi].setpointA', status: 'changed', ignored: false, renderHint: 'scalar', aValue: 90, bValue: 95 }]);
  });

  it('reports a whole added/removed alarm as one row, not a flattened property-by-property diff', () => {
    const a = { alarms: [{ name: 'Hi', setpointA: 90 }] };
    const b = { alarms: [{ name: 'Hi', setpointA: 90 }, { name: 'Lo', setpointA: 10 }] };
    const rows = computePropDiff(a, b, new Set());
    expect(rows).toEqual([{ key: 'alarms[Lo]', status: 'added', ignored: false, renderHint: 'json', bValue: { name: 'Lo', setpointA: 10 } }]);
  });

  it('matches eventScripts by eventid and flags the script body as renderHint "script"', () => {
    const a = { eventScripts: [{ eventid: 'valueChanged', script: 'line1' }] };
    const b = { eventScripts: [{ eventid: 'valueChanged', script: 'line1\nline2' }] };
    const rows = computePropDiff(a, b, new Set());
    expect(rows).toEqual([{ key: 'eventScripts[valueChanged].script', status: 'changed', ignored: false, renderHint: 'script', aValue: 'line1', bValue: 'line1\nline2' }]);
  });

  it('recurses into nested plain objects like parameters, diffing key by key', () => {
    const a = { parameters: { InstanceName: 'Motor1', PLCInstance: 'PLC01' } };
    const b = { parameters: { InstanceName: 'Motor2', PLCInstance: 'PLC01' } };
    const rows = computePropDiff(a, b, new Set());
    expect(rows).toEqual([{ key: 'parameters.InstanceName', status: 'changed', ignored: false, renderHint: 'scalar', aValue: 'Motor1', bValue: 'Motor2' }]);
  });

  it('treats an entirely absent side (whole node added) as every top-level key being added', () => {
    const rows = computePropDiff(undefined, { name: 'NewTag', dataType: 'Int4' }, new Set());
    expect(rows.sort((x, y) => x.key.localeCompare(y.key))).toEqual([
      { key: 'dataType', status: 'added', ignored: false, renderHint: 'scalar', bValue: 'Int4' },
      { key: 'name', status: 'added', ignored: false, renderHint: 'scalar', bValue: 'NewTag' },
    ]);
  });

  it('returns no rows when both sides are identical', () => {
    const obj = { dataType: 'Int4', opcItemPath: 'ns=2;s=X' };
    expect(computePropDiff(obj, { ...obj }, new Set())).toEqual([]);
  });
});
