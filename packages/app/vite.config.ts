import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Plain local web app — no native shell, no build-time toolchain beyond Node.
// See PLAN.md §1 for why (Rust/Tauri traded away for zero-toolchain setup).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
  },
});
