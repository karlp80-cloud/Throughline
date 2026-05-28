// @ts-check
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-cli/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'cli/test-fixtures/**',
      'src-tauri/target/**',
      'msi-extract/**',
    ],
  },
  ...tseslint.configs.recommended,
  prettier,
);
