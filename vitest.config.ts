import { defineConfig } from 'vitest/config';

export default defineConfig({
  // CSL styles and locales are bundled as text (esbuild's text loader); the same here.
  plugins: [
    {
      name: 'csl-as-text',
      transform(code, id) {
        if (/\.(csl|xml)$/.test(id)) return { code: `export default ${JSON.stringify(code)};`, map: null };
        return undefined;
      },
    },
  ],
  test: {
    include: ['plugins/*/src/**/*.test.ts', 'plugins/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
