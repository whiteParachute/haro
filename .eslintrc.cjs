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
    // FEAT-002 R6: global ban on @anthropic-ai/sdk (raw Anthropic API). The
    // only compliant Claude path is `@anthropic-ai/claude-agent-sdk`, and even
    // that is restricted below to the provider-claude package.
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@anthropic-ai/sdk',
            message:
              'FEAT-002 R6: do NOT import @anthropic-ai/sdk — the only compliant Claude entrypoint is @anthropic-ai/claude-agent-sdk inside @haro/provider-claude.',
          },
        ],
      },
    ],
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

// FEAT-002 R6: scope @anthropic-ai/claude-agent-sdk imports to the
// provider-claude package only. The override below applies to every package
// under packages/**/src (except provider-claude itself, which gets an opt-out
// override added *after* this one so its rule config wins). Inverting the
// scope this way means new packages inherit the ban by default — the
// previous allowlist approach silently failed for any package we forgot to
// enumerate.
module.exports.overrides.push({
  files: ['packages/**/src/**/*.ts'],
  excludedFiles: ['packages/provider-claude/**'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@anthropic-ai/sdk',
            message:
              'FEAT-002 R6: do NOT import @anthropic-ai/sdk — the only compliant Claude entrypoint is @anthropic-ai/claude-agent-sdk inside @haro/provider-claude.',
          },
          {
            name: '@anthropic-ai/claude-agent-sdk',
            message:
              'FEAT-002 R6: @anthropic-ai/claude-agent-sdk is only allowed inside @haro/provider-claude. Core / CLI / generic provider packages must go through the AgentProvider abstraction.',
          },
        ],
      },
    ],
  },
});
