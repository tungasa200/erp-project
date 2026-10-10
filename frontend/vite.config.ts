/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// 화면 오류 보고(P4-13)의 release 칸: Vercel 빌드면 커밋 해시 앞 7자. VITE_ 이름이라 import.meta.env로 보인다
const commit = process.env.VERCEL_GIT_COMMIT_SHA
if (commit && !process.env.VITE_RELEASE) process.env.VITE_RELEASE = commit.slice(0, 7)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA (P4-03, NFR-06, D-182). 아이콘은 WY-design 목업 MOB-PWA(public/icons). 워커는 src/sw/sw.ts
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      // 글꼴(Pretendard 조각 92개, 약 3.5MB)은 미리 받지 않고 쓸 때 워커가 담아 둔다(sw.ts)
      injectManifest: { globPatterns: ['**/*.{js,css,html,png}'] },
      manifest: {
        name: 'WY Worklog',
        short_name: 'Worklog',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#4B3FD6',
        background_color: '#F2F4FA',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // 바로가기 '빠른 기록'은 앱을 열고 빠른 기록 시트(SCR-MOB-01)를 바로 띄운다(AppShell이 ?quick=1을 읽음)
        shortcuts: [
          {
            name: '빠른 기록',
            short_name: '빠른 기록',
            url: '/?quick=1',
            icons: [{ src: '/icons/shortcut-quick-96.png', sizes: '96x96', type: 'image/png' }],
          },
        ],
      },
    }),
  ],
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
