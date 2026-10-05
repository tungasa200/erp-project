import { createBrowserRouter } from 'react-router'
import { AppShell } from '../components/AppShell'
import { GuestOnly, RequireAuth } from './guards'
import { ErrorPage } from '../pages/ErrorPage'
import { HomePage } from '../pages/HomePage'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ForgotPasswordPage } from '../pages/password/ForgotPasswordPage'
import { ResetPasswordPage } from '../pages/password/ResetPasswordPage'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { SignupPage } from '../pages/SignupPage'
import { GeneralSettings } from '../settings/GeneralSettings'
import { ProfileSettings } from '../settings/ProfileSettings'
import { ProjectSettings } from '../settings/ProjectSettings'
import { SettingsIndex, SettingsLayout } from '../settings/SettingsLayout'

export const routes = [
  {
    errorElement: <ErrorPage />,
    children: [
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
              { path: '/calendar', element: <PlaceholderPage title="캘린더" /> },
              { path: '/tasks', element: <PlaceholderPage title="업무" /> },
              { path: '/logs', element: <PlaceholderPage title="업무일지" /> },
              { path: '/stats', element: <PlaceholderPage title="통계" /> },
              {
                path: '/settings',
                element: <SettingsLayout />,
                children: [
                  { index: true, element: <SettingsIndex /> },
                  { path: 'profile', element: <ProfileSettings /> },
                  { path: 'general', element: <GeneralSettings /> },
                  { path: 'projects', element: <ProjectSettings /> },
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
