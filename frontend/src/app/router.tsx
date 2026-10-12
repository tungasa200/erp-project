import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { GuestOnly, RequireAuth } from './guards'
import { HashScroll } from './HashScroll'
import { LogsRedirect } from './LogsRedirect'
import { ErrorPage } from '../pages/ErrorPage'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ForgotPasswordPage } from '../pages/password/ForgotPasswordPage'
import { ResetPasswordPage } from '../pages/password/ResetPasswordPage'
import { SignupPage } from '../pages/SignupPage'

/**
 * 화면 코드는 그 화면에 처음 갈 때 받는다(UX-COM-15: 앱 전체가 JS 한 덩어리라 랜딩·로그인도 캘린더·통계를 함께 받았다).
 * 첫 묶음에는 라우터·가드·랜딩·인증 화면만 남는다. 이동은 조각을 받은 뒤에 바뀌어서 그동안 지금 화면이 그대로 있다
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return { lazy: async () => ({ Component: (await load())[name] }) }
}

const appShell = () => import('../components/AppShell')
const calendar = () => import('../calendar/CalendarPage')
const settingsLayout = () => import('../settings/SettingsLayout')

/** 숨긴 업무일지 화면(SCR-LOG-01·02, 사용자 결정 2026-10-12). 앱에는 연결하지 않고 화면 코드를 지키는 시험만 쓴다(test/renderApp routesWithHidden) */
export const hiddenLogRoutes = [
  { path: '/logs', ...page(() => import('../logs/LogListPage'), 'LogListPage') },
  { path: '/logs/:type/:date', ...page(() => import('../logs/LogPage'), 'LogPage') },
]
/** 숨긴 설정 프로필 탭(SCR-SET-01, 사용자 결정 2026-10-12 카드 2335: 이름·소속·직책은 일지 머리에만 쓰임). 저장된 값·API는 그대로 */
export const hiddenProfileRoute = {
  path: 'profile',
  ...page(() => import('../settings/ProfileSettings'), 'ProfileSettings'),
}

export const routes = [
  {
    // 주소의 #id로 스크롤(처리방침 섹션 링크 등)
    element: <HashScroll />,
    errorElement: <ErrorPage />,
    children: [
      // 개인정보 처리방침 SCR-AUTH-06·이용약관 SCR-AUTH-07(P4-11, frontend2): 로그인과 상관없이 보이는 공개 화면, AppShell 밖.
      // 점검 중에도 보인다(MaintenanceGate PUBLIC_PATHS, D-177 ②)
      { path: '/privacy', ...page(() => import('../landing/PrivacyPage'), 'PrivacyPage') },
      { path: '/terms', ...page(() => import('../landing/TermsPage'), 'TermsPage') },
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/signup', element: <SignupPage /> },
          { path: '/password/forgot', element: <ForgotPasswordPage /> },
          { path: '/password/reset', element: <ResetPasswordPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            ...page(appShell, 'AppShell'),
            children: [
              { path: '/', ...page(() => import('../pages/HomePage'), 'HomePage') },
              // 캘린더(P1-07, frontend2): /calendar는 오늘의 주 보기(모바일은 일 보기)로 보낸다
              { path: '/calendar', ...page(calendar, 'CalendarIndexRedirect') },
              { path: '/calendar/list', ...page(calendar, 'CalendarPage') },
              { path: '/calendar/:view/:date', ...page(calendar, 'CalendarPage') },
              // 업무 목록, 행을 누르면 오른쪽 상세 패널 (SCR-TASK-01·02)
              // 보관함 SCR-TASK-04(P4-10, frontend2): /tasks/:taskId보다 먼저 맞도록 /tasks 밖 형제 경로
              { path: '/tasks/archive', ...page(() => import('../archive/ArchivePage'), 'ArchivePage') },
              {
                path: '/tasks',
                ...page(() => import('../tasks/TaskListPage'), 'TaskListPage'),
                children: [{ path: ':taskId', ...page(() => import('../tasks/TaskDetailPanel'), 'TaskDetailPanel') }],
              },
              // 업무일지(P3: 목록 SCR-LOG-01, 상세·편집 SCR-LOG-02)는 숨김(사용자 결정 2026-10-12). 화면 코드는 logs/에 남아 있고 길만 홈으로 돌린다
              { path: '/logs', element: <LogsRedirect /> },
              { path: '/logs/*', element: <LogsRedirect /> },
              // 통계 SCR-STAT-01(P4-02, frontend2)
              { path: '/stats', ...page(() => import('../stats/StatsPage'), 'StatsPage') },
              // 알림 SCR-COM-05 ③ 모바일 전체 화면(P4-01, frontend2). 데스크톱은 종 팝오버
              {
                path: '/notifications',
                ...page(() => import('../notifications/NotificationsPage'), 'NotificationsPage'),
              },
              // SCR-SET-07 회원 탈퇴(P4-05): 설정 메뉴 없이 한 화면(목업 SET-07)
              {
                path: '/settings/account/deletion',
                ...page(() => import('../settings/AccountDeletion'), 'AccountDeletion'),
              },
              {
                path: '/settings',
                ...page(settingsLayout, 'SettingsLayout'),
                children: [
                  { index: true, ...page(settingsLayout, 'SettingsIndex') },
                  { path: 'profile', element: <Navigate to="/settings/general" replace /> },
                  { path: 'general', ...page(() => import('../settings/GeneralSettings'), 'GeneralSettings') },
                  { path: 'recording', ...page(() => import('../settings/RecordingSettings'), 'RecordingSettings') },
                  { path: 'projects', ...page(() => import('../settings/ProjectSettings'), 'ProjectSettings') },
                  // SCR-SET-05 알림(P4-01): 알림 센터 [알림 설정] 링크가 여기로 온다
                  {
                    path: 'notifications',
                    ...page(() => import('../notifications/NotificationSettings'), 'NotificationSettings'),
                  },
                  // SCR-SET-04 테마(P4-09)
                  { path: 'theme', ...page(() => import('../settings/ThemeSettings'), 'ThemeSettings') },
                  // SCR-SET-06 계정(P4-08 비밀번호 변경)
                  { path: 'account', ...page(() => import('../settings/AccountSettings'), 'AccountSettings') },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
