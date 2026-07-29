import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Admin } from './routes/Admin'
import { Screen } from './routes/Screen'
import { Vote } from './routes/Vote'
import { segmentAfter, usePathname } from './router'
import './styles/app.css'

function App() {
  const pathname = usePathname()

  if (pathname === '/admin' || pathname.startsWith('/admin/')) return <Admin />

  const screenEventId = segmentAfter(pathname, '/screen/')
  if (screenEventId) return <Screen eventId={screenEventId} />

  // Everything else is the voter flow. `/` resolves the current event
  // server-side so a QR code can point at the bare origin.
  return <Vote eventId={segmentAfter(pathname, '/v/')} />
}

const container = document.getElementById('root')
if (!container) throw new Error('missing #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
