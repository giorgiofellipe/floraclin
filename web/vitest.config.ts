import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    // Only component tests (.test.tsx) pay for a DOM. Server, query and lib
    // tests (.test.ts) run in plain Node, which starts much faster. A .ts test
    // that does need the DOM opts in with `// @vitest-environment jsdom`.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
