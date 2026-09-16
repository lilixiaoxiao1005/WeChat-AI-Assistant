/* eslint-env node */
// 前端 ESLint 基础配置（仅用内置 eslint:recommended，不引入额外插件，避免改动构建链路）
// 说明：本工程 package.json 声明 "type":"module"，故配置文件用 .cjs（CommonJS）扩展名。
// 仅覆盖 .js / .jsx；.ts/.tsx 如需强约束，请后续安装 @typescript-eslint 并扩展本配置。
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true }
  },
  ignorePatterns: ['dist', 'node_modules', 'src-tauri', '*.config.js', '*.config.ts'],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }]
  }
};
