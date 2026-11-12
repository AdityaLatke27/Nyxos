import { loadEphemerisTable } from './astro/ephemerisTable'
import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const SimApp = lazy(() => import('./sim/SimApp'))
const LandingApp = lazy(() => import('./landing/ui/LandingApp'))
const CompareApp = lazy(() => import('./landing/ui/CompareApp'))

void loadEphemerisTable()
const isSimulator = window.location.pathname.startsWith('/app')
const isLanding = /^\/app\/landing\/?$/.test(window.location.pathname)
const isCompare = /^\/app\/compare\/?$/.test(window.location.pathname)

// No StrictMode: its double-invoked effects would run the multi-second GPU
// sunlight bakes twice in development.
createRoot(document.getElementById('root')!).render(
  isCompare ? (
    <Suspense fallback={null}>
      <CompareApp />
    </Suspense>
  ) : isLanding ? (
    <Suspense fallback={null}>
      <LandingApp />
    </Suspense>
  ) : isSimulator ? (
    <Suspense fallback={null}>
      <SimApp />
    </Suspense>
  ) : (
    <App />
  ),
)
