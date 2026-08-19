export * from './types.js';
export { DEFAULT_IGNORED_KEYS, stableStringify, fnv1a, computeOwnHash, computeNodeHash } from './hash.js';
export { parseTagFile, TagParseError, classifyKind } from './parse.js';
export { serializeTagFile } from './serialize.js';
export { buildAlignmentIndex, parentAlignPath, alignPathName, type AlignmentIndex } from './alignment.js';
export { diffLines, type LineDiffOp } from './textDiff.js';
export { computePropDiff } from './propDiff.js';
export { diffTagFiles } from './diff.js';
export { extractSubtree } from './subtree.js';
export {
  buildMergePlan,
  applyMergePlan,
  findMissingUdtDefs,
  pullInUdtDefs,
  type BuildMergePlanInput,
  type ApplyMergeResult,
  type MissingUdtDef,
} from './merge.js';
