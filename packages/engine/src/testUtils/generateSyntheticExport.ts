// Deterministic synthetic Ignition-tag-export generator, used for round-trip
// fixpoint tests and (Phase 1+) performance benchmarking against the 50k-tag
// target in PLAN.md §3.4. Not a substitute for real gateway fixtures — it
// exercises the engine's tree/ordering/type-variety mechanics, not Ignition's
// actual export schema quirks.

import type { JsonObject, JsonValue } from '../types.js';

export interface SyntheticExportOptions {
  /** Approximate number of leaf tags (AtomicTag / UdtInstance) to generate. */
  tagCount: number;
  /** Length of the UDT inheritance chain (each level extends the previous via typeId). */
  udtDepth?: number;
  /** Branching factor used when splitting leaves across nested folders. */
  foldersPerLevel?: number;
  /** Deterministic seed — same seed always produces byte-identical output. */
  seed?: number;
  providerName?: string;
}

// mulberry32: small, fast, deterministic PRNG (public-domain algorithm).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSyntheticExport(options: SyntheticExportOptions): JsonObject {
  const { tagCount, udtDepth = 1, foldersPerLevel = 5, seed = 42, providerName = 'default' } = options;
  const rand = mulberry32(seed);

  const udtNames = buildUdtChain(udtDepth);
  const typesFolder: JsonObject = {
    name: '_types_',
    tagType: 'Folder',
    tags: udtNames.map((name, i) => makeUdtDef(name, i > 0 ? udtNames[i - 1] : undefined, i)),
  };

  const leafUdtType = udtNames[udtNames.length - 1]!;
  const dataTree = buildFolderTree('Area1', tagCount, foldersPerLevel, leafUdtType, rand);

  return {
    name: providerName,
    tagType: 'Provider',
    tags: [typesFolder, dataTree],
  };
}

function buildUdtChain(depth: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < Math.max(1, depth); i++) {
    names.push(i === 0 ? 'MotorBase' : `MotorV${i + 1}`);
  }
  return names;
}

function makeUdtDef(name: string, parentTypeId: string | undefined, level: number): JsonObject {
  const def: JsonObject = {
    name,
    tagType: 'UdtType',
    tags: [
      {
        name: 'Speed',
        tagType: 'AtomicTag',
        dataType: 'Float8',
        valueSource: 'opc',
        opcItemPath: `ns=2;s=[{PLCInstance}]Motors.{InstanceName}.Speed`,
        opcServer: 'Ignition OPC UA Server',
      },
      {
        name: 'Running',
        tagType: 'AtomicTag',
        dataType: 'Boolean',
        valueSource: 'opc',
        opcItemPath: `ns=2;s=[{PLCInstance}]Motors.{InstanceName}.Running`,
        opcServer: 'Ignition OPC UA Server',
        alarms: [
          {
            name: 'RunFault',
            enabled: true,
            setpointA: 1,
            mode: 'Above',
          },
        ],
      },
    ],
    parameters: {
      InstanceName: { dataType: 'String' },
      PLCInstance: { dataType: 'String' },
    },
  };
  if (parentTypeId) {
    def.typeId = parentTypeId;
  }
  if (level === 0) {
    def.tags = (def.tags as JsonValue[]).concat([
      {
        name: 'onSpeedChange',
        tagType: 'AtomicTag',
        dataType: 'Float8',
        valueSource: 'memory',
        eventScripts: [
          {
            eventid: 'valueChanged',
            script: "if newValue.value > 90:\n\tsystem.tag.write('[.]Running', True)\n",
          },
        ],
      },
    ]);
  }
  return def;
}

/** Recursively splits `count` leaves across nested folders of width `branching`. */
function buildFolderTree(
  name: string,
  count: number,
  branching: number,
  udtType: string,
  rand: () => number,
): JsonObject {
  if (count <= branching) {
    const tags: JsonObject[] = [];
    for (let i = 0; i < count; i++) {
      tags.push(rand() < 0.5 ? makeUdtInstance(`Motor_${name}_${i}`, udtType) : makeAtomicTag(`Sensor_${name}_${i}`, rand));
    }
    return { name, tagType: 'Folder', tags };
  }

  const children: JsonObject[] = [];
  let remaining = count;
  for (let i = 0; i < branching && remaining > 0; i++) {
    const isLast = i === branching - 1;
    const share = isLast ? remaining : Math.ceil(remaining / (branching - i));
    children.push(buildFolderTree(`${name}_${i}`, share, branching, udtType, rand));
    remaining -= share;
  }
  return { name, tagType: 'Folder', tags: children };
}

function makeUdtInstance(instanceName: string, udtType: string): JsonObject {
  return {
    name: instanceName,
    tagType: 'UdtInstance',
    typeId: udtType,
    parameters: {
      InstanceName: instanceName,
      PLCInstance: 'PLC01',
    },
  };
}

function makeAtomicTag(name: string, rand: () => number): JsonObject {
  const dataType = rand() < 0.5 ? 'Float8' : 'Int4';
  return {
    name,
    tagType: 'AtomicTag',
    dataType,
    valueSource: 'opc',
    opcItemPath: `ns=2;s=[PLC01]Sensors.${name}`,
    opcServer: 'Ignition OPC UA Server',
    engUnit: dataType === 'Float8' ? 'PSI' : 'count',
  };
}
