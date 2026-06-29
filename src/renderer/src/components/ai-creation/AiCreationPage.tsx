import { useMemo } from 'react'
import { useAuthStore } from '@renderer/stores/auth-store'

/**
 * Base URL for the AI创作 (AI Creation) service.
 * Change this to match your deployment.
 */
const DEFAULT_AI_CREATION_URL = 'http://192.168.77.100:3001'

export function AiCreationPage(): React.JSX.Element {
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const iframeUrl = useMemo(() => {
    const base = DEFAULT_AI_CREATION_URL
    const params = new URLSearchParams()
    if (isAuthenticated && user) {
      params.set('userId', user.id)
      params.set('userName', user.username)
    }
    return `${base}/?${params.toString()}`
  }, [user, isAuthenticated])

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <iframe
        src={iframeUrl}
        className="h-full w-full border-none"
        title="AI Creation"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  )
}
