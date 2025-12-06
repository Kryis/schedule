import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // IMPORTANT: Replace '/your-repo-name/' with your actual GitHub repository name
  // e.g., if your repo is 'my-schedule', this should be '/my-schedule/'
  base: '/your-repo-name/',
})