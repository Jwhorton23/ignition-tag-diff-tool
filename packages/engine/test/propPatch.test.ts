import { describe, expect, it } from 'vitest';
import { applyPropertyPatch } from '../src/index.js';

describe('applyPropertyPatch', () => {
  it('patches a plain top-level scalar property, leaving everything else untouched', () => {
    const base = { opcItemPath: 'ns=2;s=Dev', engUnit: 'PSI', documentation: 'keep me' };
    const source = { opcItemPath: 'ns=2;s=Prod', engUnit: 'BAR', documentation: 'ignore me' };
    const patched = applyPropertyPatch(base, source, 'opcItemPath');
    expect(patched).toEqual({ opcItemPath: 'ns=2;s=Prod', engUnit: 'PSI', documentation: 'keep me' });
  });

  it('patches a nested plain-object property (parameters.X)', () => {
    const base = { parameters: { InstanceName: 'Motor1', PLCInstance: 'PLC01' } };
    const source = { parameters: { InstanceName: 'Motor2', PLCInstance: 'PLC99' } };
    const patched = applyPropertyPatch(base, source, 'parameters.InstanceName');
    expect(patched).toEqual({ parameters: { InstanceName: 'Motor2', PLCInstance: 'PLC01' } });
  });

  it('patches one field inside an identity-keyed array item (alarms[Hi].setpointA)', () => {
    const base = { alarms: [{ name: 'Hi', setpointA: 90, priority: 'High' }, { name: 'Lo', setpointA: 10 }] };
    const source = { alarms: [{ name: 'Hi', setpointA: 95, priority: 'High' }, { name: 'Lo', setpointA: 5 }] };
    const patched = applyPropertyPatch(base, source, 'alarms[Hi].setpointA');
    expect(patched).toEqual({
      alarms: [
        { name: 'Hi', setpointA: 95, priority: 'High' }, // setpointA patched, priority untouched
        { name: 'Lo', setpointA: 10 }, // untouched — not part of this patch
      ],
    });
  });

  it('adds a whole new identity-keyed array item when patching "arrayKey[id]" itself', () => {
    const base = { alarms: [{ name: 'Hi', setpointA: 90 }] };
    const source = { alarms: [{ name: 'Hi', setpointA: 90 }, { name: 'Lo', setpointA: 10 }] };
    const patched = applyPropertyPatch(base, source, 'alarms[Lo]');
    expect(patched).toEqual({ alarms: [{ name: 'Hi', setpointA: 90 }, { name: 'Lo', setpointA: 10 }] });
  });

  it('removes a whole identity-keyed array item when the source no longer has it', () => {
    const base = { alarms: [{ name: 'Hi', setpointA: 90 }, { name: 'Lo', setpointA: 10 }] };
    const source = { alarms: [{ name: 'Hi', setpointA: 90 }] };
    const patched = applyPropertyPatch(base, source, 'alarms[Lo]');
    expect(patched).toEqual({ alarms: [{ name: 'Hi', setpointA: 90 }] });
  });

  it('patches a script body inside an eventScripts identity-keyed entry', () => {
    const base = { eventScripts: [{ eventid: 'valueChanged', script: 'old' }] };
    const source = { eventScripts: [{ eventid: 'valueChanged', script: 'new' }] };
    const patched = applyPropertyPatch(base, source, 'eventScripts[valueChanged].script');
    expect(patched).toEqual({ eventScripts: [{ eventid: 'valueChanged', script: 'new' }] });
  });

  it('removes a top-level property entirely when the source does not have it', () => {
    const base = { name: 'X', documentation: 'has one' };
    const source = { name: 'X' };
    const patched = applyPropertyPatch(base, source, 'documentation');
    expect(patched).toEqual({ name: 'X' });
  });

  it('preserves unknown/future properties not touched by the patch', () => {
    const base = { name: 'X', futureProp_83: { nested: true } };
    const source = { name: 'X', opcItemPath: 'ns=2;s=New' };
    const patched = applyPropertyPatch(base, source, 'opcItemPath');
    expect(patched.futureProp_83).toEqual({ nested: true });
  });
});
