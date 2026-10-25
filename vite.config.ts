import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',   // relative asset paths, so the build works from any folder or a GitHub Pages subpath
  test: { testTimeout: 60_000 },   // the scripted matches simulate several minutes of play
});
