// Deep equality that also asserts object KEY ORDER matches, since round-trip
// fidelity requires more than value-equality — plain deepStrictEqual would
// pass even if keys were reordered, which is exactly the class of bug this
// suite exists to catch (PLAN.md §9).

export function assertOrderedEqual(actual: unknown, expected: unknown, path = '$'): void {
  if (expected === null || typeof expected !== 'object') {
    if (!Object.is(actual, expected)) {
      throw new Error(`Value mismatch at ${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    return;
  }
  if (actual === null || typeof actual !== 'object') {
    throw new Error(`Type mismatch at ${path}: expected object/array, got ${JSON.stringify(actual)}`);
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      throw new Error(`Type mismatch at ${path}: expected array, got object`);
    }
    if (actual.length !== expected.length) {
      throw new Error(`Array length mismatch at ${path}: expected ${expected.length}, got ${actual.length}`);
    }
    expected.forEach((v, i) => assertOrderedEqual(actual[i], v, `${path}[${i}]`));
    return;
  }
  if (Array.isArray(actual)) {
    throw new Error(`Type mismatch at ${path}: expected object, got array`);
  }

  const expectedKeys = Object.keys(expected as object);
  const actualKeys = Object.keys(actual as object);
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((k, i) => k !== expectedKeys[i])) {
    throw new Error(
      `Key order/set mismatch at ${path}:\n  expected: [${expectedKeys.join(', ')}]\n  actual:   [${actualKeys.join(', ')}]`,
    );
  }
  for (const key of expectedKeys) {
    assertOrderedEqual((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`);
  }
}
