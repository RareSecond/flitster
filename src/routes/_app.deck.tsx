import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { DeckScreen } from '../components/DeckScreen'

export const Route = createFileRoute('/_app/deck')({ component: DeckPage })

function DeckPage() {
  const navigate = useNavigate()
  return <DeckScreen onBack={() => navigate({ to: '/' })} />
}
