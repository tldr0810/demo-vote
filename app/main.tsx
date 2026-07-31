import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Admin } from './routes/Admin'
import { PrintCodes } from './routes/PrintCodes'
import { Screen } from './routes/Screen'
import { Vote } from './routes/Vote'
import { adminRoute } from './adminRoute'
import { segmentAfter, usePathname } from './router'
import './styles/app.css'

function App() {
  const pathname = usePathname()

  // One parser for everything under /admin, so the print sheet and an event
  // dashboard — which differ by a single path segment — cannot be told apart in
  // two places that disagree. The print sheet is dealt with here rather than
  // inside Admin because it has no shell: it is a page that gets sent to a
  // printer.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const route = adminRoute(pathname)
    if (route.kind === 'print') return <PrintCodes eventId={route.id} />
    return <Admin />
  }

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
