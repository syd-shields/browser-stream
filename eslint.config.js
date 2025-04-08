import { defineConfig } from 'eslint/config';

export default defineConfig({
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint', 'unused-imports', 'prettier'],
    root: true,
});
