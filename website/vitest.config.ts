// Runs website tests inside workerd with the bindings from wrangler.jsonc.

import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/remote-control-tunnel.ts',
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
