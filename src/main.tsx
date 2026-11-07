import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const SimApp = lazy(() => import('./sim/SimApp'))

const isSimulator = window.location.pathname.startsWith('/app')

// No StrictMode: its double-invoked effects would run the multi-second GPU
// sunlight bakes twice in development.
createRoot(document.getElementById('root')!).render(
  isSimulator ? (
    <Suspense fallback={null}>
      <SimApp />
    </Suspense>
  ) : (
    <App />
  ),
)
