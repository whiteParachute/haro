/* Haro monorepo ESLint config (R2/R7). */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.ts', '.d.ts'],
      },
    },
  },
  rules: {
    'import/no-cycle': ['warn', { maxDepth: 10 }],
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': 'off',
  },
  overrides: [
    {
      // R7 placeholder: core must stay Provider/Channel-agnostic. FEAT-002 /
      // FEAT-008 replace this with a dedicated @haro/no-provider-hardcode
      // plugin; until then we block the two literal patterns that would
      // violate the "no-intrusion plugin principle" in core source.
      files: ['packages/core/src/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'warn',
          {
            selector:
              "BinaryExpression[operator='==='][left.type='Identifier'][left.name='providerId'][right.type='Literal']",
            message:
              'R7: core module must not hard-code providerId comparisons. Route through the provider registry.',
          },
          {
            selector:
              "BinaryExpression[operator='==='][right.type='Identifier'][right.name='providerId'][left.type='Literal']",
            message:
              'R7: core module must not hard-code providerId comparisons. Route through the provider registry.',
          },
          {
            selector:
              "BinaryExpression[operator='==='][left.type='Identifier'][left.name='channelId'][right.type='Literal']",
            message:
              'R7: core module must not hard-code channelId comparisons. Route through the channel registry.',
          },
          {
            selector:
              "BinaryExpression[operator='==='][right.type='Identifier'][right.name='channelId'][left.type='Literal']",
            message:
              'R7: core module must not hard-code channelId comparisons. Route through the channel registry.',
          },
          {
            selector:
              "BinaryExpression[operator='==='][left.type='MemberExpression'][left.property.name='providerId'][right.type='Literal']",
            message:
              'R7: core module must not hard-code providerId comparisons (member form). Route through the provider registry.',
          },
          {
            selector:
              "BinaryExpression[operator='==='][left.type='MemberExpression'][left.property.name='channelId'][right.type='Literal']",
            message:
              'R7: core module must not hard-code channelId comparisons (member form). Route through the channel registry.',
          },
        ],
      },
    },
  ],
  ignorePatterns: [
    'dist/**',
    'node_modules/**',
    '**/*.d.ts',
    '**/*.js',
    '**/*.cjs',
  ],
};
