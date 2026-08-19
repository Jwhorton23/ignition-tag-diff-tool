import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseTagFile, serializeTagFile } from '../src/index.js';
import { generateSyntheticExport } from '../src/testUtils/generateSyntheticExport.js';
import { assertOrderedEqual } from './orderedEqual.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicFixturesDir = path.resolve(__dirname, '../../../fixtures/public');

function roundTripFixture(text: string, label: string) {
  const original = JSON.parse(text);

  const file = parseTagFile(text, label);
  const serialized = serializeTagFile(file);
  const roundTripped = JSON.parse(serialized);

  // 1. Structural + key-order fidelity: re-parsing the serialized output
  //    must reproduce the original object tree exactly, including key order.
  assertOrderedEqual(roundTripped, original, `$(${label})`);

  // 2. Fixpoint: serializing an already-round-tripped file produces byte-
  //    identical output to the first serialization (idempotency).
  const file2 = parseTagFile(serialized, label);
  const serialized2 = serializeTagFile(file2);
  expect(serialized2).toBe(serialized);

  return { file, serialized };
}

describe('round-trip fidelity — public fixtures', () => {
  const files = readdirSync(publicFixturesDir).filter((f) => f.endsWith('.json'));

  it('found at least one public fixture', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const fixtureFile of files) {
    it(`parses and re-serializes ${fixtureFile} with zero drift`, () => {
      const fullPath = path.join(publicFixturesDir, fixtureFile);
      const text = readFileSync(fullPath, 'utf8');
      roundTripFixture(text, fixtureFile);
    });
  }
});

describe('round-trip fidelity — synthetic exports', () => {
  const cases: Array<{ label: string; tagCount: number; udtDepth?: number; foldersPerLevel?: number }> = [
    { label: 'tiny-flat', tagCount: 3, foldersPerLevel: 10 },
    { label: 'small-nested', tagCount: 40, foldersPerLevel: 4 },
    { label: 'udt-chain-depth-3', tagCount: 25, udtDepth: 3, foldersPerLevel: 5 },
  ];

  for (const c of cases) {
    it(`round-trips synthetic export "${c.label}" (${c.tagCount} tags)`, () => {
      const synthetic = generateSyntheticExport({
        tagCount: c.tagCount,
        udtDepth: c.udtDepth,
        foldersPerLevel: c.foldersPerLevel,
        seed: 1234,
      });
      const text = JSON.stringify(synthetic, null, 2);
      roundTripFixture(text, c.label);
    });
  }

  it('is deterministic for a fixed seed', () => {
    const a = generateSyntheticExport({ tagCount: 50, seed: 7 });
    const b = generateSyntheticExport({ tagCount: 50, seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('round-trip fidelity — BOM and CRLF preservation', () => {
  it('preserves a UTF-8 BOM through round-trip', () => {
    const withBom = '﻿' + JSON.stringify({ name: 'x', tagType: 'Folder', tags: [] }, null, 2);
    const file = parseTagFile(withBom, 'bom-test');
    expect(file.meta.hadBom).toBe(true);
    const serialized = serializeTagFile(file);
    expect(serialized.charCodeAt(0)).toBe(0xfeff);
  });

  it('preserves CRLF line endings through round-trip', () => {
    const lf = JSON.stringify({ name: 'x', tagType: 'Folder', tags: [] }, null, 2);
    const crlf = lf.replace(/\n/g, '\r\n');
    const file = parseTagFile(crlf, 'crlf-test');
    expect(file.meta.eol).toBe('crlf');
    const serialized = serializeTagFile(file);
    expect(serialized.includes('\r\n')).toBe(true);
    expect(serialized.includes('\n')).toBe(true); // sanity: file has newlines at all
  });

  it('does not corrupt an escaped newline inside a script string when converting EOL', () => {
    const obj = {
      name: 'x',
      tagType: 'AtomicTag',
      eventScripts: [{ eventid: 'valueChanged', script: 'line1\nline2\r\nline3' }],
    };
    const lf = JSON.stringify(obj, null, 2);
    const crlf = lf.replace(/\n/g, '\r\n');
    const file = parseTagFile(crlf, 'script-eol-test');
    const serialized = serializeTagFile(file);
    const reparsed = JSON.parse(serialized);
    // The embedded script string's newlines must be untouched, independent
    // of the file's own structural EOL.
    expect(reparsed.eventScripts[0].script).toBe('line1\nline2\r\nline3');
  });
});
