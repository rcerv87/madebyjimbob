import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', 'server/tmp/**', '.localdb/**'] },
  js.configs.recommended,
  { rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  {
    files: ['server/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
  },
  {
    files: ['web/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.3' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
    },
  },
  {
    files: ['web/src/test/**', 'web/vite.config.js'],
    languageOptions: { globals: { ...globals.node, mockApi: 'readonly', FakeWebSocket: 'readonly' } },
  },
  prettier,
];
