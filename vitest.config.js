import { defineConfig } from 'vitest/config';
import { transformWithOxc } from 'vite';

// Lets component tests import src/**/*.js files that contain JSX (Next.js allows JSX in .js).
const jsxInJs = {
  name: 'jsx-in-js',
  enforce: 'pre',
  async transform(code, id) {
    const file = id.split('?')[0];
    if (!/\/src\/.*\.js$/.test(file) || file.includes('/node_modules/') || !/<[A-Za-z][^>]*>/.test(code)) return null;
    return transformWithOxc(code, file.replace(/\.js$/, '.jsx'), { lang: 'jsx', jsx: { runtime: 'automatic' } });
  },
};

export default defineConfig({
  plugins: [jsxInJs],
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
