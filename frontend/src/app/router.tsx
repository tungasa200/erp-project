import { createBrowserRouter } from 'react-router'
import { CalendarIndexRedirect, CalendarPage } from '../calendar/CalendarPage'
import { AppShell } from '../components/AppShell'
import { GuestOnly, RequireAuth } from './guards'
import { ErrorPage } from '../pages/ErrorPage'
import { HomePage } from '../pages/HomePage'
import { LoginPage } from '../pages/LoginPage'
import { LogListPage } from '../logs/LogListPage'
import { LogPage } from '../logs/LogPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { NotificationsPage } from '../notifications/NotificationsPage'
import { PrivacyPage } from '../landing/PrivacyPage'
import { TermsPage } from '../landing/TermsPage'
import { ForgotPasswordPage } from '../pages/password/ForgotPasswordPage'
import { ResetPasswordPage } from '../pages/password/ResetPasswordPage'
import { SignupPage } from '../pages/SignupPage'
import { ArchivePage } from '../archive/ArchivePage'
import { StatsPage } from '../stats/StatsPage'
import { AccountDeletion } from '../settings/AccountDeletion'
import { AccountSettings } from '../settings/AccountSettings'
import { GeneralSettings } from '../settings/GeneralSettings'
import { ProfileSettings } from '../settings/ProfileSettings'
import { ProjectSettings } from '../settings/ProjectSettings'
import { RecordingSettings } from '../settings/RecordingSettings'
import { SettingsIndex, SettingsLayout } from '../settings/SettingsLayout'
import { TaskDetailPanel } from '../tasks/TaskDetailPanel'
import { TaskListPage } from '../tasks/TaskListPage'

export const routes = [
  {
    errorElement: <ErrorPage />,
    children: [
      // 개인정보 처리방침 SCR-AUTH-06·이용약관 SCR-AUTH-07(P4-11, frontend2): 로그인과 상관없이 보이는 공개 화면, AppShell 밖.
      // 점검 중에도 보인다(MaintenanceGate PUBLIC_PATHS, D-177 ②)
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/terms', element: <TermsPage /> },
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
            element: <AppShell />,
            children: [
              { path: '/', element: <HomePage /> },
              // 캘린더(P1-07, frontend2): /calendar는 오늘의 주 보기(모바일은 일 보기)로 보낸다
              { path: '/calendar', element: <CalendarIndexRedirect /> },
              { path: '/calendar/list', element: <CalendarPage /> },
              { path: '/calendar/:view/:date', element: <CalendarPage /> },
              // 업무 목록, 행을 누르면 오른쪽 상세 패널 (SCR-TASK-01·02)
              // 보관함 SCR-TASK-04(P4-10, frontend2): /tasks/:taskId보다 먼저 맞도록 /tasks 밖 형제 경로
              { path: '/tasks/archive', element: <ArchivePage /> },
              {
                path: '/tasks',
                element: <TaskListPage />,
                children: [{ path: ':taskId', element: <TaskDetailPanel /> }],
              },
              // 업무일지(P3): 목록 SCR-LOG-01, 상세·편집 SCR-LOG-02
              { path: '/logs', element: <LogListPage /> },
              { path: '/logs/:type/:date', element: <LogPage /> },
              // 통계 SCR-STAT-01(P4-02, frontend2)
              { path: '/stats', element: <StatsPage /> },
              // 알림 SCR-COM-05 ③ 모바일 전체 화면(P4-01, frontend2). 데스크톱은 종 팝오버
              { path: '/notifications', element: <NotificationsPage /> },
              // SCR-SET-07 회원 탈퇴(P4-05): 설정 메뉴 없이 한 화면(목업 SET-07)
              { path: '/settings/account/deletion', element: <AccountDeletion /> },
              {
                path: '/settings',
                element: <SettingsLayout />,
                children: [
                  { index: true, element: <SettingsIndex /> },
                  { path: 'profile', element: <ProfileSettings /> },
                  { path: 'general', element: <GeneralSettings /> },
                  { path: 'recording', element: <RecordingSettings /> },
                  { path: 'projects', element: <ProjectSettings /> },
                  // SCR-SET-06 계정(P4-08 비밀번호 변경)
                  { path: 'account', element: <AccountSettings /> },
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
