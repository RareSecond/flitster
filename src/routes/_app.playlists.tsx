import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { PlaylistScreen } from '../components/PlaylistScreen'

export const Route = createFileRoute('/_app/playlists')({ component: PlaylistsPage })

function PlaylistsPage() {
  const navigate = useNavigate()
  return <PlaylistScreen onBack={() => navigate({ to: '/' })} />
}
