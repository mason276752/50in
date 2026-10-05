import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 相對路徑：部署到 https://<user>.github.io/<repo>/ 不用寫死 repo 名稱
  base: './',
  plugins: [vue()],
})
