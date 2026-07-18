import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
