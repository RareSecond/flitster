import { createFileRoute } from '@tanstack/react-router'
import App from '../App'

export const Route = createFileRoute('/_app')({
  // Keep device APIs client-only in development as well as the production SPA.
  ssr: false,
  component: App,
  pendingComponent: () => <main className="app"><h1>Flitster</h1><p className="hint">Loading…</p></main>,
})
