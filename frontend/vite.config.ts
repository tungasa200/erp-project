/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 로컬 api-gateway로 프록시해 배포(Vercel rewrites)와 같은 사이트 구성을 맞춘다 (NFR-14).
    proxy: {
      '/api': process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080',
    },
    // 공휴일 데이터는 프론트·worklog 공용으로 저장소 루트 shared/에 있다 (P1-07). 개발 서버가 그 파일을 읽게 허용한다.
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), '../shared'],
    },
  },
  test: {
    environment: 'jsdom',
    // Windows에서 forks 워커가 jsdom 초기화 중 시작 시간 제한에 걸려 threads를 쓴다.
    pool: 'threads',
    testTimeout: 20000,
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
})
