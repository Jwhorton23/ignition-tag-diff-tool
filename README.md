# Ignition Tag Diff & Merge Tool

A locally running web app for diffing and merging Ignition SCADA tag exports — a purpose-built "git difftool for tags," not a generic JSON viewer. Import two `.json` tag exports, see a structural diff of the tag trees (UDT-aware, ignores property order), select what to carry over, resolve conflicts, and export a merge result that imports cleanly back into Ignition.

See [PLAN.md](PLAN.md) for the full architecture, data model, and roadmap.

## Getting started

Requires [Node.js](https://nodejs.org/) 20+. No other install — no Rust, no Electron, nothing native.

```bash
git clone https://github.com/Jwhorton23/ignition-tag-diff-tool.git
cd ignition-tag-diff-tool
npm install
npm run dev
```

Then open **http://localhost:1420** in Chrome or Edge (needed for the native file Open/Save dialogs — see PLAN.md §1).

## Other scripts (run from the repo root)

```bash
npm test          # engine unit tests (parse/diff/merge/serialize)
npm run build     # production build of the web app
npm run preview   # serve the production build locally
```

## Project layout

```
packages/engine/   Pure TypeScript: parse, diff, merge, serialize — no UI dependencies
packages/app/       React UI (Vite), runs the engine in a Web Worker
fixtures/public/    Synthetic tag export fixtures (committed)
fixtures/private/   Real sanitized gateway exports for local testing (gitignored — never committed)
```
