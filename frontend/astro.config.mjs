// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  base: '/',
  vite: {
    server: {
      allowedHosts: ['adhoc.maixnor.com'],
    },
  },
});
