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
  {
    // Logos are SVGs, which next/image serves unoptimized, and photos are
    // signed URLs or data URLs that editors need as plain <img> elements.
    rules: { '@next/next/no-img-element': 'off' },
  },
]
