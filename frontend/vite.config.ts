import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { labSessionPlugin } from './vite-plugin-lab-session.ts'

export default defineConfig({
  plugins: [react(), labSessionPlugin()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    fileParallelism: false,
  },
})
