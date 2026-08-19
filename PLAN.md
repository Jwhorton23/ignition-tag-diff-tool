# Ignition Tag Diff & Merge Tool — Implementation Plan

## Context

MES integration work with Ignition SCADA (8.1 and 8.3) constantly involves comparing tag exports between environments (dev vs. QA vs. prod, site vs. site) and migrating subsets of tags. Ignition's tag browser gives no diff capability, and generic JSON diff tools are line-based, order-sensitive, and blind to tag semantics (UDT inheritance, folder hierarchy, OPC path conventions). The goal is a purpose-built, locally running "git difftool for tags": import two exports, see a structural side-by-side diff of the tag trees, cherry-pick changes, and export a merge result that imports cleanly back into Ignition — with perfect pass-through of unknown properties.

Decisions confirmed with the user:
- **Ignition versions**: 8.1 **and** 8.3 export formats, explicitly tested.
- **Fixtures**: real (sanitized) gateway exports will be provided for testing.
- **Export scope**: full merged tree **and** subtree-rooted export for targeted imports.
- **Packaging**: originally a single portable `.exe` (Tauri); revised during Phase 0 to a local web app — see §1.

---

## 1. Architecture & Stack

**Recommendation: local web app — React + TypeScript (Vite), served by `npm run dev`, with all domain logic in TypeScript running in a Web Worker.**

> **Revision note:** the plan originally chose Tauri v2 for a lean ~10 MB portable `.exe`. Building that shell requires a Rust toolchain + MSVC Build Tools on the dev machine — a ~15-20 minute one-time install the user found not worth it for a solo-maintained internal tool. Traded away in favor of zero native toolchain, ever: `npm install && npm run dev` is the entire setup, on this machine or any future one. The one remaining prerequisite is Node.js itself (a ~2 minute installer) — accepted explicitly over the alternative (packaging a standalone server via Node's single-executable-app feature) as extra packaging work not worth it for this audience.

| Option | Verdict | Why |
|---|---|---|
| **Local web app (Vite + React, `npm run dev`)** | ✅ **Chosen** | Zero native toolchain to build or run, on any machine, ever. The **File System Access API** (`showOpenFilePicker`/`showSaveFilePicker`), available in Chrome/Edge when served from `localhost` (a secure context), gives real native-style Open/Save dialogs — not a downloads-folder dump — so the file-access downside a plain web app usually has doesn't apply here. Edge ships with every Windows machine; the only prerequisite is Node.js to run the dev server. |
| Tauri v2 | ❌ (reversed) | Would still be the leaner shipped artifact (~10 MB portable exe vs. shipping/running full source) and the nicer "real desktop app" feel, but requires Rust + MSVC Build Tools on every machine that builds it — friction the user weighed against the benefit and declined for a solo-maintained tool. Revisit if a true installer-free native shell becomes worth it later; the engine package is portable to it unchanged (see below). |
| Electron | ❌ | 150+ MB output, installer-oriented tooling, heavier memory, and still a build step beyond plain `npm install`. Nothing it offers over the web-app choice that justifies that. |
| Python (PyQt / pywebview) | ❌ | Weakest story for virtualized 50k-node tree rendering and single-file Windows distribution (PyInstaller AV false-positives, size). |

**Key architectural rule: the entire domain engine (parse → index → diff → merge → serialize) is a pure TypeScript package with zero UI and zero runtime-shell dependencies.** Benefits:
- Unit-testable with Vitest in plain Node — no app harness needed.
- Runs inside a **Web Worker** so parsing/diffing 100 MB files never blocks the UI.
- Portable if the shell decision is ever revisited: the engine drops into Tauri or Electron unchanged, since it never depends on either.

### Project layout

```
/packages/engine/      # Pure TS: parser, model, diff, merge, serialize, validate
/packages/app/         # React UI (Vite), workers, state — plain web app, no native shell
/fixtures/             # Real sanitized exports (git-ignored if sensitive) + synthetic
PLAN.md
```

### Runtime dataflow

```
File pick / drag-drop ──> File System Access API read (string) ──> Worker: parse + index + hash
                                                                     │
User opens a modified tag <── lazy property diff <────────────────── Worker: tree diff (A vs B)
User selects nodes + resolves conflicts ─────────────────────────> Worker: merge build
                                                                     │
                                              Worker: serialize ──> File System Access API write
```

Main-thread ↔ worker messages carry compact summaries (status, counts, node ids); full raw JSON objects stay in the worker and are fetched per-node on demand. This keeps the React side light even with 50k+ tags.

**Browser requirement**: the load/export screens (Phase 1) target Chromium-based browsers (Edge, Chrome) for `showOpenFilePicker`/`showSaveFilePicker`. Both ship on every Windows machine already. A `<input type="file">` + download fallback is a cheap Phase 1 addition if Firefox support ever matters, but isn't planned unless it comes up.

---

## 2. Data Model

### 2.1 Parsed tag tree

```ts
type NodeKind = 'provider' | 'folder' | 'udt-def' | 'udt-instance' | 'tag' | 'unknown';

interface TagNode {
  id: string;            // canonical path, e.g. "_types_/Motors/MotorV2" or "Area1/Line3/Speed"
  name: string;
  kind: NodeKind;        // derived from tagType + location (under _types_ ⇒ udt-def)
  tagType?: string;      // raw tagType value (AtomicTag, UdtInstance, UdtType, Folder, Provider…)
  typeId?: string;       // for UDT instances: reference into the definition index
  raw: JsonObject;       // the ORIGINAL node object, untouched, minus the "tags" array
  childIds: string[];    // preserves source file ordering
  structuralHash: string;// hash of raw (post-ignore-list) + sorted child hashes
  sourceIndex: number;   // position within parent's "tags" array (ordering fidelity)
}

interface TagFile {
  filePath: string;
  rootIds: string[];         // usually one provider or one folder/tag root
  nodes: Map<string, TagNode>;
  udtDefs: Map<string, string>;  // typeId -> node id (built from _types_ subtree)
  meta: { detectedVersionHint: '8.1' | '8.3' | 'unknown'; hadBom: boolean; eol: 'lf'|'crlf' };
}
```

**Fidelity rules (non-negotiable):**
- `raw` is the exact parsed object. The engine *reads* known properties but never rewrites, reorders, or normalizes `raw`. Unknown/future properties ride along by construction.
- `JSON.parse`/`JSON.stringify` preserve string-key insertion order, so key order survives. The one known lossy spot is numeric formatting (`1.0` parses to `1`). Round-trip tests on real fixtures decide whether this matters to Ignition (it does not — Ignition's importer is tolerant of numeric form); if a fixture proves otherwise, swap in `lossless-json` for parse/serialize. Decide in Phase 0, not later.
- Canonical **path id** uses `/`-joined names relative to the file root, with the provider name stripped into `meta` so cross-provider comparison (dev provider `devTags` vs prod `default`) aligns naturally.

### 2.2 Diff results

```ts
type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged' | 'type-changed';

interface DiffNode {
  path: string;                 // alignment key (case-normalized; original casings kept)
  status: DiffStatus;
  aId?: string; bId?: string;   // ids into fileA/fileB node maps
  childPaths: string[];
  rollup: { added: number; removed: number; modified: number };  // subtree badge counts
  udtImpact?: 'def-changed' | 'def-missing-in-a' | 'def-missing-in-b'; // instance badges
  caseOnlyRename?: boolean;
}

interface PropDiff {           // computed lazily per node when opened
  key: string;                 // dotted path into raw: "alarms[HiHi].setpoint", "eventScripts[valueChanged].script"
  status: 'added' | 'removed' | 'changed';
  aValue?: JsonValue; bValue?: JsonValue;
  renderHint: 'scalar' | 'script' | 'json';  // script ⇒ show line-based text diff of the body
  ignored: boolean;            // matched the ignore-list; shown greyed, excluded from status rollups
}
```

### 2.3 Merge model

```ts
type MergeDirection = 'into-a' | 'into-b' | 'new-file';

type MergeOp =
  | { op: 'add';     path: string; from: 'a' | 'b' }
  | { op: 'remove';  path: string }
  | { op: 'replace'; path: string; from: 'a' | 'b' }
  | { op: 'patch';   path: string; props: Array<{ key: string; from: 'a' | 'b' }> }; // cherry-pick

interface MergePlan {
  direction: MergeDirection;
  baseFile: 'a' | 'b' | null;   // null for new-file (structure seeded from selections)
  ops: MergeOp[];
  transforms: Transform[];       // find/replace + strip/normalize, applied at export
}
```

The merge is a **reviewable plan of ops**, not direct tree mutation — this powers the "staged changes" review screen, undo, and the diff report.

---

## 3. Diff Algorithm

### 3.1 Alignment: by canonical path

Tags have stable identity via hierarchy path — no need for expensive tree-edit-distance (Zhang-Shasha etc.). Alignment is a straight map join:

1. Build `Map<canonicalPath, node>` for A and B during parse (already needed for indexing).
2. Union of keys ⇒ per-path status: only-A ⇒ `removed`, only-B ⇒ `added`, both ⇒ compare.
3. Same path but different `tagType` (e.g., folder became UDT instance) ⇒ `type-changed` (rendered as remove+add, never property-merged).
4. **Case-insensitive** path normalization for alignment (Ignition paths are case-insensitive), with `caseOnlyRename` flagged when casing differs.
5. Optional **root remap**: if A's root is provider `default` and B's is `devTags`, roots pair up positionally by default with a manual remap control; folder-level exports compare relative to their roots.

Renames/moves are *not* detected in MVP — a moved tag shows as removed+added, same as git without rename detection. (Phase 4 candidate: suggest pairs among added/removed leaves with equal `structuralHash`.)

### 3.2 Property comparison

- For paths in both files: compare a hash of the node's OWN properties (`ownHash`) first — **not** the subtree-inclusive `structuralHash`. Equal ⇒ `unchanged`, done — no deep walk.
  > **Implementation correction (Phase 1):** the first cut of this compared `structuralHash` (own properties + children folded in bottom-up), which marked every ancestor of any changed leaf as `modified` too — a folder whose own properties never changed would still show `modified` because *something inside it* did. Fixed by adding a second hash, `ownHash` (own properties only, no children), and using that for per-node status. `structuralHash` is kept on `TagNode` and still computed the same way; it's reserved for a possible future "skip this whole unchanged subtree" fast-path (§3.4) rather than status classification. Rollup counts (`rollup.added/removed/modified/inherited`) are what carry "something changed below here" up to ancestors — matching the wireframe's folder badges — while the folder's own status glyph stays accurate.
- Hashes are computed bottom-up at parse time: `hash(node) = H(stableStringify(raw minus ignored keys) + childHashes)`. Stable-stringify sorts keys, so **property order never affects diff status** (while raw order is still preserved for output).
- Unequal ⇒ `modified`; the detailed `PropDiff[]` is computed **lazily** when the user opens the tag: recursive structural walk over both `raw` objects. Nested structures diff by identity key where one exists (alarms by `name`, eventScripts by event key, parameters by key) and by index otherwise.
- **Ignore-list** (configurable, with sensible defaults: `value`, quality/timestamp echoes, transient engineering fields) is applied at hash time, so noisy properties can't mark a subtree modified. Changing the ignore-list triggers a re-hash + re-diff (fast, see 3.4).
- Script bodies (`eventScripts[*].script`, expression bodies) get a **line-based text diff** rendering (the one place line diffing is right) via a small LCS/Myers implementation or `diff` npm package.

### 3.3 UDT definitions vs. instances

- `_types_` subtree diffs like everything else — definitions are just nodes.
- After the tree diff, a **UDT impact pass** runs: for every instance node (in either file), look up its `typeId` chain (including UDT inheritance via a definition's own `typeId`) in the definitions index:
  - Definition modified between A and B ⇒ every instance of that type (and subtypes) gets `udtImpact: 'def-changed'` — rendered as a distinct badge ("inherited change") even when the instance's own overrides are identical. These do **not** count as `modified` in rollups; they get their own rollup counter so folders show e.g. `3 modified · 12 inherited`.
  - Instance whose `typeId` has no definition in its own file ⇒ validation error; missing in the *other* file ⇒ `def-missing-in-*` warning surfaced during merge (see §4, dependency pull-in).
- **Explicitly out of scope for MVP:** computing *effective* instance values (definition defaults + parameter substitution + instance overrides). The exported instance JSON only contains overrides, and diffing overrides + flagging definition changes covers the practical workflow. Effective-value diff ("what will this instance actually do") is a Phase 4 stretch item and the plan's representation (raw override diff + impact badge) is designed so it can be added without model changes.

### 3.4 Performance strategy (50k+ nodes, ~100 MB files)

- All heavy work in a Web Worker; UI receives a flat summary array.
- `JSON.parse` of 100 MB ≈ 1–2 s — acceptable; show progress states (read → parse → index → diff).
- Hash short-circuiting makes the common case (large identical subtrees) near-O(changed).
- Tree UI is **virtualized** (`@tanstack/react-virtual`): the visible tree is a flattened array of expanded rows; only ~40 DOM rows exist regardless of tree size.
- Lazy `PropDiff` keeps memory flat; the worker holds both files' node maps, the main thread holds only strings/ids/statuses.
- Benchmark gate in CI: synthetic 50k-tag fixture must parse+diff < 3 s and expand/scroll at 60 fps (manual check).

---

## 4. Merge Engine & Conflict Resolution

### 4.1 Selection model

- Tri-state checkboxes on the diff tree (checked / unchecked / partial), operating on **diff statuses**, meaning "carry this difference in the chosen direction":
  - `added` node selected, direction into-A ⇒ `add` op from B.
  - `removed` node selected, direction into-A ⇒ keep (no-op) or, when "mirror deletions" toggle is on, `remove` op — deletions are opt-in and visually loud, never silently included by subtree selection.
  - `modified` node selected ⇒ conflict entry requiring resolution.
- Selecting a folder selects its differing descendants (deletions excluded per above).
- **Known Phase 1 limitation:** checkboxes only exist on non-`unchanged` nodes, so `new-file` builds can only be assembled from tags that differ somewhere between A and B — there's no way yet to sweep an identical (unchanged) UDT instance or folder into a new-file export. Fine for the "package up just what changed" workflow; a "grab this whole folder, changed or not" mode for new-file is a candidate Phase 2 addition if it turns out to matter in practice.

### 4.2 Conflict resolution

Every selected `modified` tag lands in the **conflict queue** with three resolutions:
1. **Take A** (replace with A's raw)
2. **Take B** (replace with B's raw)
3. **Cherry-pick** — property-level picker: each `PropDiff` row gets an A/B toggle; result is a `patch` op. Patch application is surgical: only listed keys are overwritten in the base `raw`; all other properties (including unknown ones) stay byte-identical from the base side.

Bulk resolution controls ("take B for all conflicts under this folder") because 200-conflict queues are real.

### 4.3 Dependency safety (UDT pull-in)

Before export, the engine walks the merge result: every UDT instance's `typeId` chain must resolve inside the output tree (or be explicitly acknowledged as "already exists on target gateway"). If an instance is merged but its definition isn't:
- Offer one-click **"include required definitions"** (adds the def subtree from the source side), or
- Let the user acknowledge and proceed (definition already on the target) — recorded in the export summary.

Same check for dataTypes referenced by parameters where detectable. This single feature prevents the most common broken-import scenario.

### 4.4 Output construction & fidelity

- **into-A / into-B**: deep-structural copy of the base file's tree; ops applied by path. Untouched nodes serialize from their original `raw` with original key order and original child order (`sourceIndex`). Added nodes append to the parent's `tags` array (matching Ignition's own append behavior); their internal ordering comes from the source file.
- **new-file**: minimal skeleton (provider/folder root chosen by user) containing only selected subtrees + pulled-in `_types_`; ancestor folders are synthesized as bare `{name, tagType: "Folder", tags: []}` nodes.
- **Subtree export**: any folder in the merge result can be exported rooted at itself (importable at that folder in the Designer tag browser).
- Serializer: 2-space indent, UTF-8; BOM and EOL matched to the base file's `meta`. For new-file, defaults to no BOM + LF (matching gateway exports).
- Transforms (find/replace, strip/normalize — §5) apply as a final pass over a deep copy, never mutating loaded files.

---

## 5. Nice-to-have Features — Verdicts

| Feature | Verdict | Notes |
|---|---|---|
| Search/filter (name, tagType, dataType, OPC path substring, has-alarms, has-scripts) | ✅ Phase 2 | Cheap on the flat index; filter produces a pruned tree (ancestors of matches kept). Essential for 50k-tag navigation. |
| **Bulk find-and-replace on properties** | ✅ Phase 3, flagship | The environment-migration killer feature. Scoped to: property selector (default `opcItemPath`, `opcServer`; any string property selectable), literal or regex, **mandatory preview table** (path · property · before → after) with per-row opt-out, applied as an export transform. Also usable standalone (load one file → transform → export) without a diff. |
| Strip/normalize on export (remove history, remove alarms, clear values, remove docs/tooltips) | ✅ Phase 3 | Checklist of named strippers implemented as pure transforms; composable with find/replace. |
| Validation pass (duplicate paths, missing UDT defs, broken param bindings, dangling `{param}` refs) | ✅ Phase 3 (missing-UDT-def check lands in MVP via §4.3) | Runs on load and pre-export; results panel with click-to-navigate. |
| Diff report export (CSV + Markdown) | ✅ Phase 4 | Direct render of the diff summary + merge plan ops. Cheap, great for change-control docs. |
| Recently used files / drag-and-drop | ✅ Drag-drop in MVP, recents in Phase 4 | Recents = JSON in app-config dir with quick "reload pair" pairing. |
| Ignore-list for noisy properties | ✅ Phase 2 | Built into the hash pipeline from day one (§3.2); Phase 2 adds the UI to edit it. Defaults shipped. |
| Rename/move detection | ⚠️ Phase 4 stretch | Hash-match suggestion among added/removed; useful but not core. |
| Effective UDT instance values | ⚠️ Phase 4 stretch | See §3.3. |
| 3-way merge with common ancestor | ❌ Not planned | Real workflow is 2-way. Model doesn't preclude it later. |

---

## 6. UI / UX Design

Purpose-built difftool feel: dense, keyboard-friendly, status-colored, zero chrome.

### Screens

1. **Load screen** — two large drop zones (File A / File B), recent pairs list, "swap A↔B". Parsing progress inline.
2. **Diff view** (main workspace) — see wireframe.
3. **Merge review & export** — staged ops list, conflict queue, transforms, validation results, export options.

### Diff view wireframe

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ A: dev_export.json (default)   ⇄   B: prod_export.json (default)    [Merge ▸ 14] │
│ [filter: name/path… ] [type ▾] [status: ●add ●rem ●mod ○unchg] [☰ ignore-list]   │
├───────────────────────────────┬──────────────────────────────────────────────────┤
│ TREE (unified, virtualized)   │ DETAIL: Line3/Conveyor7/SpeedSP        [modified] │
│                               │ ┌──────────────────────────────────────────────┐ │
│ ▾ ☐ _types_        3●         │ │ property        A (dev)        B (prod)      │ │
│   ▾ ☐ Motors                  │ │ opcItemPath     ns=2;s=Dev.…   ns=2;s=Prd.…  ⚑│ │
│     ☐ ⬤ MotorV2   modified    │ │ alarms[Hi].setpoint  95.0      92.5          ⚑│ │
│ ▾ ◪ Area1        12● 3+ 1−    │ │ engUnit         (ignored: value, tooltip)  ⋯ │ │
│   ▾ ☑ Line3                   │ ├──────────────────────────────────────────────┤ │
│     ☑ ⊕ NewTag     added      │ │ eventScripts[valueChanged].script   [text ⇵] │ │
│     ☑ ⬤ SpeedSP    modified   │ │  - if val > 90:                              │ │
│     ☐ ⊖ OldTag     removed    │ │  + if val > 85:                              │ │
│   ▸ ☐ Line4        ~2 inh     │ └──────────────────────────────────────────────┘ │
│ ▸ ☐ Area2          unchanged  │ Conflict: ( Take A ) ( Take B ) ( Cherry-pick ⚑ )│
├───────────────────────────────┴──────────────────────────────────────────────────┤
│ 48,211 tags · 214 modified · 37 added · 12 removed · 96 inherited   [Export…]    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Design decisions:
- **One unified tree**, not two side-by-side trees. Two trees with 50k nodes and scroll-sync is the classic mistake — alignment is already computed, so a single tree with status glyphs (⊕ added / ⊖ removed / ⬤ modified / `inh` inherited badge) carries strictly more information with half the navigation cost. The **side-by-side lives in the detail pane**, where A/B columns per property is the natural git-style reading.
- Status filter chips hide `unchanged` by default (the difftool default people expect).
- Tri-state checkboxes directly on the tree; the `[Merge ▸ N]` button shows staged-op count and opens the review screen.
- Cherry-pick ⚑ toggles appear per property row right in the detail pane.
- Keyboard: `j/k` next/prev difference, `space` toggle selection, `enter` open detail, `a`/`b` resolve conflict.
- Script diffs render as unified text diff blocks with syntax highlighting (small, e.g. Shiki or highlight.js — evaluated in Phase 2 for bundle size).

### Merge review screen (summary)

Left: op list grouped by folder (add/remove/replace/patch, each with source side). Middle: unresolved-conflict queue with the same detail pane. Right rail: direction selector, transforms (find/replace rules, strip options), validation results, export target (full tree / subtree root picker), Export button disabled until conflicts = 0 and validation errors acknowledged.

---

## 7. Phased Roadmap (each phase ships something usable)

### Phase 0 — Foundation & fidelity proof (the risk-killer)
- Scaffold the Vite + React + TS workspace as a plain local web app (no native shell — §1); `npm run dev`/`npm run build` from day one.
- `packages/engine`: parser → model → serializer, **round-trip test suite against real fixtures first**.
- Decide `JSON.parse` vs `lossless-json` based on fixture evidence (§2.1).
- Synthetic fixture generator (parameterized: N tags, UDT depth, script bodies) for perf tests.
- ✔ Usable output: CLI-ish engine that proves lossless round-trip — the whole tool is pointless if this fails, so it goes first.

### Phase 1 — MVP: import → diff → select → merge → export
- Load screen with drag-drop; worker pipeline (read/parse/index/hash/diff).
- Virtualized unified diff tree with status glyphs, rollup badges, expand/collapse.
- Detail pane: lazy property diff, script text diff.
- Tri-state selection, direction choice, Take-A/Take-B conflict resolution (cherry-pick deferred to keep MVP tight), UDT dependency pull-in check, export (full tree + subtree root), verified by importing into a real 8.1 and 8.3 gateway.
- ✔ Usable output: the core daily workflow end-to-end.

### Phase 2 — Navigate & trust the diff
- Search/filter bar (name/path/type/dataType/has-alarms/has-scripts/status).
- Ignore-list editor with shipped defaults; re-diff on change.
- UDT impact badges + "inherited" rollup counter (impact pass itself lands in Phase 1 for the dependency check; this phase surfaces it fully in UI).
- Property-level cherry-pick UI.
- Keyboard navigation; hide-unchanged default.

### Phase 3 — Migration power tools
- Bulk find-and-replace with regex + preview table + per-row opt-out; standalone single-file mode.
- Strip/normalize transform checklist.
- Full validation pass (duplicate paths incl. case-collisions, missing defs, dangling `{param}` bindings) with results panel.

### Phase 4 — Reporting & polish
- Diff report export (Markdown + CSV).
- Recent file pairs; window state persistence.
- Perf hardening against the 50k benchmark; stretch: rename detection, effective-UDT diff.

---

## 8. Edge Cases & Risks

| Risk / edge case | Handling |
|---|---|
| Malformed / truncated JSON, UTF-8 BOM, CRLF | Detect BOM/EOL at read (recorded in `meta`, re-emitted on export); parse errors show position + context snippet, never a blank screen. |
| Export root shapes vary (full provider vs. folder subtree vs. single tag object) | Parser normalizes to root list; diff runs relative to roots; UI shows what shape each file is. |
| Provider name differs between environments | Alignment is provider-relative (§3.1) with manual root remap. |
| 8.1 vs 8.3 format drift (new properties, changed defaults) | Pass-through design absorbs unknown props by construction; version hint detected and shown; fixture matrix covers both; any *structural* 8.3 change (shape, not just props) gets a targeted parser branch. |
| Case-only path collisions (`Motor1` vs `motor1` as siblings) | Validation error — Ignition itself will collide on import. Case-only *cross-file* differences flagged as rename, not modify+add. |
| Script bodies: unicode escapes, `\r\n` vs `\n` inside strings, huge scripts | Never re-encode — scripts live inside `raw` and serialize from the original parsed string. Text diff is display-only. EOL differences inside scripts are a real diff (shown with whitespace markers), optionally ignorable via ignore-list rule. |
| Numeric formatting loss (`1.0` → `1`) | Phase 0 fixture verdict; `lossless-json` contingency (§2.1). |
| Duplicate sibling names in a malformed export | Parser keeps both (id suffixing) + validation error; never silently drops a node. |
| Memory: two 100 MB files + indexes in one worker | Node maps hold references into one parsed structure (no raw duplication); detail pane fetches per-node; if a real ceiling is hit, move each file into its own worker. |
| Mirroring deletions destroys tags on target | Deletions opt-in, visually distinct, summarized in export confirmation (§4.1). |
| User imports merge output at wrong tree location | Export dialog states the intended import root; subtree exports name the file after the root by default (`Area1_Line3_tags.json`). |
| Non-Chromium browser (Firefox, Safari) lacks `showOpenFilePicker`/`showSaveFilePicker` | Documented requirement: use Edge or Chrome (both ship with Windows). Cheap `<input type="file">` + download fallback is a known Phase 1 addition if this ever actually blocks someone. |
| Single maintainer bus-factor / complexity creep | Engine/UI separation, no exotic dependencies, roadmap phases independently shippable, CI runs the build + test suite on every merge. |

---

## 9. Testing Strategy

**Engine (Vitest, pure Node — the bulk of testing):**
- **Round-trip fidelity (the crown jewel):** for every real fixture: `parse → serialize` must produce structurally identical JSON *including key order* (compared via ordered-key walk, not just deep-equal), and byte-identical modulo the documented numeric-formatting caveat — or fully byte-identical if `lossless-json` is adopted. Also: `parse → serialize → parse → serialize` fixpoint (second pass byte-identical to first).
- **Diff correctness:** golden tests on hand-built fixture pairs (each status, UDT def change → instance badges, ignore-list suppression, type-changed, case-rename). Property-based test: take a fixture, apply N random known mutations, assert the diff reports exactly those N paths and nothing else.
- **Merge correctness:** for each op type: apply → serialize → re-parse → assert target subtree equals source side's subtree and *everything else is byte-identical to base*. Cherry-pick patch tests assert untouched sibling properties (incl. planted unknown props like `"futureProp_83": {...}`) survive untouched.
- **Transforms:** find/replace preview == applied result; strippers remove exactly their keys; transforms compose deterministically.
- **Validation:** each rule has positive + negative fixtures.
- **Performance:** synthetic 50k-tag fixture; CI asserts parse+index+hash+diff under threshold (generous in CI, e.g. 8 s; 3 s target locally).

**Integration / UI:**
- Playwright smoke suite (Chromium project, matching the File System Access API requirement — §1): load pair → expand → open modified tag → select → resolve → export → assert output file vs golden.
- Worker protocol contract tests (message shapes, progress events, error propagation).

**Acceptance (manual, gated per release):**
- Import each exported merge result into real Ignition 8.1 **and** 8.3 gateways (Designer tag import): no errors, spot-check alarms/scripts/UDT bindings live. Documented checklist in the repo; this is the test Ignition itself performs and nothing else substitutes for it.

**Fixture policy:** real sanitized exports live in `fixtures/private/` (git-ignored), synthetic + hand-made minimal fixtures in `fixtures/public/` (committed). Every engine bug fixed gets a minimal public fixture reproducing it.
