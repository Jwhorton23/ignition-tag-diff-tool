import { describe, expect, it } from 'vitest';
import { applyStrip, parseTagFile } from '../src/index.js';

function file(obj: unknown) {
  return parseTagFile(JSON.stringify(obj), 'test.json');
}

const NONE = { removeHistory: false, removeAlarms: false, clearValues: false, removeDocumentation: false };

describe('applyStrip', () => {
  it('removes history-related properties when removeHistory is set', () => {
    const f = file({
      name: 'root',
      tagType: 'Folder',
      tags: [{ name: 'A', tagType: 'AtomicTag', dataType: 'Int4', historyEnabled: true, historyProvider: 'default', engUnit: 'PSI' }],
    });
    const result = applyStrip(f, { ...NONE, removeHistory: true });
    const raw = result.nodes.get('root/A')?.raw;
    expect(raw?.historyEnabled).toBeUndefined();
    expect(raw?.historyProvider).toBeUndefined();
    expect(raw?.engUnit).toBe('PSI'); // untouched
    expect(raw?.dataType).toBe('Int4'); // untouched
  });

  it('removes the alarms array when removeAlarms is set', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', alarms: [{ name: 'Hi', setpointA: 1 }] }] });
    const result = applyStrip(f, { ...NONE, removeAlarms: true });
    expect(result.nodes.get('root/A')?.raw.alarms).toBeUndefined();
  });

  it('clears the value property when clearValues is set', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', value: 42, dataType: 'Int4' }] });
    const result = applyStrip(f, { ...NONE, clearValues: true });
    expect(result.nodes.get('root/A')?.raw.value).toBeUndefined();
    expect(result.nodes.get('root/A')?.raw.dataType).toBe('Int4');
  });

  it('removes documentation and tooltip when removeDocumentation is set', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', documentation: 'notes', tooltip: 'hint' }] });
    const result = applyStrip(f, { ...NONE, removeDocumentation: true });
    const raw = result.nodes.get('root/A')?.raw;
    expect(raw?.documentation).toBeUndefined();
    expect(raw?.tooltip).toBeUndefined();
  });

  it('composes multiple strip options in one pass', () => {
    const f = file({
      name: 'root',
      tagType: 'Folder',
      tags: [{ name: 'A', tagType: 'AtomicTag', value: 1, alarms: [{ name: 'Hi' }], historyEnabled: true, documentation: 'x', engUnit: 'PSI' }],
    });
    const result = applyStrip(f, { removeHistory: true, removeAlarms: true, clearValues: true, removeDocumentation: true });
    const raw = result.nodes.get('root/A')?.raw;
    expect(raw).toEqual({ name: 'A', tagType: 'AtomicTag', engUnit: 'PSI' });
  });

  it('is a no-op (returns the same file reference) when nothing is selected', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', value: 1 }] });
    expect(applyStrip(f, NONE)).toBe(f);
  });

  it('does not mutate the source file', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', value: 1 }] });
    applyStrip(f, { ...NONE, clearValues: true });
    expect(f.nodes.get('root/A')?.raw.value).toBe(1);
  });

  it('leaves nodes without any matching keys untouched (same TagNode reference)', () => {
    const f = file({ name: 'root', tagType: 'Folder', tags: [{ name: 'A', tagType: 'AtomicTag', engUnit: 'PSI' }, { name: 'B', tagType: 'AtomicTag', value: 5 }] });
    const original = f.nodes.get('root/A');
    const result = applyStrip(f, { ...NONE, clearValues: true });
    expect(result.nodes.get('root/A')).toBe(original); // A had no `value` key — untouched reference
    expect(result.nodes.get('root/B')).not.toBe(f.nodes.get('root/B'));
  });
});
