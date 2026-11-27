import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Shared base config. Projects (`unit`, `int`) are declared in vitest.workspace.mts
// (vitest 2.x workspace API; `--project <name>` selects one).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: false,
    environment: 'node',
    passWithNoTests: false,
  },
});
