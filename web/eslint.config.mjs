import nextConfig from 'eslint-config-next'

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '.next/**',
      'coverage/**',
      'dist/**',
      'build/**',
      'node_modules/**',
      'public/**',
      '**/*.generated.ts',
    ],
  },
  ...nextConfig,
]
