import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import tseslint from 'typescript-eslint'
import prettierRecommended from 'eslint-plugin-prettier/recommended'

const primitiveImports = {
  group: ['@base-ui/react', 'radix-ui', '@radix-ui/*', 'class-variance-authority', 'cn'],
  message: 'UI implementation details belong in core/ui; compose the shared primitives here.',
}
const businessImports = {
  group: [
    '@/modules/**',
    '**/modules/**',
    '@/collections/**',
    '**/collections/**',
    '@/payload*',
    '@payload-config',
    '@/core/payload/**',
    '**/core/payload/**',
    'payload',
    'stripe',
  ],
  message:
    'Reusable UI is presentation-only; business and persistence dependencies belong in features.',
}

export default defineConfig(
  globalIgnores([
    '.next/**',
    '.test-build/**',
    'next-env.d.ts',
    'src/payload-types.ts',
    'src/app/(payload)/admin/importMap.js',
  ]),
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Empty strings deliberately trigger a fallback for editorial text and environment values.
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true } },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    // Async test doubles implement Promise-based ports even when their data is in memory.
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    files: [
      'src/app/(frontend)/**/*.tsx',
      'src/modules/*/ui/**/*.tsx',
      'src/core/ui/forms/**/*.tsx',
      'src/core/ui/feedback/**/*.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^(button|input|select|label|textarea)$/]",
          message:
            'Use the shared shadcn primitives from @/core/ui instead of recreating a control.',
        },
      ],
      'no-restricted-imports': ['error', { patterns: [primitiveImports] }],
    },
  },
  {
    files: ['src/core/ui/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [businessImports] }],
    },
  },
  {
    files: ['src/core/ui/forms/**/*.{ts,tsx}', 'src/core/ui/feedback/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [primitiveImports, businessImports] }],
    },
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { eqeqeq: ['error', 'always'], 'no-var': 'error', 'prefer-const': 'error' },
  },
  // Must stay last: report formatting as errors and disable conflicting style rules.
  prettierRecommended,
)
