# @ignition-diff/app

React + TypeScript frontend for the Ignition Tag Diff & Merge Tool, run as a local web app (no Electron/Tauri — see PLAN.md §1).

```bash
npm run dev      # from repo root — starts Vite on http://localhost:1420
npm run build    # typecheck + production bundle to dist/
npm run preview  # serve the production bundle locally
```

Depends on `@ignition-diff/engine` (workspace package) for all parsing/diff/merge logic — this package is UI only.
