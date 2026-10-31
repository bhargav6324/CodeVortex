import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Fixed values so tests never depend on a developer's local .env.
    env: {
      VITE_API_BASE_URL: 'http://backend.test',
      VITE_USE_MOCKS: 'true',
    },
  },
})
