import { StrictMode, createContext, useContext } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { ManagedRuntime, Layer } from 'effect'
import { layerXMLHttpRequest } from '@effect/platform-browser/BrowserHttpClient'
import { routeTree } from './routeTree'
import { HttpClientLive } from './services/HttpClient'
import './index.css'

const runtime = ManagedRuntime.make(
  Layer.provide(HttpClientLive, layerXMLHttpRequest)
)

const RuntimeContext = createContext<typeof runtime | null>(null)

export const useRuntime = () => {
  const ctx = useContext(RuntimeContext)
  if (!ctx) {
    throw new Error('useRuntime must be used within RuntimeProvider')
  }
  return ctx
}

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <RuntimeContext.Provider value={runtime}>
      <RouterProvider router={router} />
    </RuntimeContext.Provider>
  </StrictMode>,
)
