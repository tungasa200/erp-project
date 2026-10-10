// E2E 설정 (P4-06, D-175 ③, D-179). 실행: npm run test:e2e (frontend에서, 설정 위치는 -c e2e)
// 전체(Chromium·WebKit·모바일 크기)는 CI에서만 돌린다. 로컬은 Chromium 하나: npm run test:e2e -- --project=chromium
// 미리 띄워 둘 것: PostgreSQL·Mailpit(docker compose --profile e2e), identity·worklog·gateway, vite preview(4173)
import { defineConfig, devices } from '@playwright/test'

const ci = !!process.env.CI

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  // 결과 폴더는 frontend/ 바로 아래(.gitignore·CI 업로드 경로와 같음)
  outputDir: '../test-results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { outputFolder: '../playwright-report', open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
    // 새 사용자의 기본 시간대가 Asia/Seoul이라 브라우저의 '오늘'을 맞춘다
    timezoneId: 'Asia/Seoul',
    locale: 'ko-KR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // 모바일 크기(≤767px): 하단 탭·빠른 기록 시트. Safari(WebKit) 모바일로 본다
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
})
