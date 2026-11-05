import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { createRootRoute, HeadContent, Link, Scripts } from '@tanstack/react-router'
import styles from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { title: 'Deckades' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no' },
      { name: 'theme-color', content: '#0b0b0f' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'apple-mobile-web-app-title', content: 'Deckades' },
    ],
    links: [
      { rel: 'stylesheet', href: styles },
      { rel: 'apple-touch-icon', href: '/icon-192.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <main className="app">
      <h1>Page not found</h1>
      <Link to="/">Back to Deckades</Link>
    </main>
  ),
})

function RootDocument({ children }: { children: ReactNode }) {
  useEffect(() => {
    void import('virtual:pwa-register').then(({ registerSW }) => {
      registerSW({ immediate: true })
    })
  }, [])

  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}
