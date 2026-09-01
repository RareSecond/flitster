/**
 * Spotify Authorization Code + PKCE.
 *
 * PKCE (not implicit / not client-secret) is the only flow that is safe in a
 * browser app and it gives us a refresh token, so the player keeps working
 * after the first hour.
 */
const AUTH_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const STORAGE_KEY = 'flitster.spotify.tokens'
const VERIFIER_KEY = 'flitster.spotify.verifier'

export const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ')

export const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined
export const REDIRECT_URI = `${window.location.origin}/`

type Tokens = { access_token: string; refresh_token?: string; expires_at: number }

const randomString = (len: number) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

const base64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const readTokens = (): Tokens | null => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
  } catch {
    return null
  }
}

const writeTokens = (raw: { access_token: string; refresh_token?: string; expires_in: number }) => {
  const existing = readTokens()
  const tokens: Tokens = {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token ?? existing?.refresh_token,
    expires_at: Date.now() + raw.expires_in * 1000 - 30_000,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
  return tokens
}

export const isLoggedIn = () => readTokens() != null

export const logout = () => localStorage.removeItem(STORAGE_KEY)

export async function login() {
  if (!CLIENT_ID) throw new Error('VITE_SPOTIFY_CLIENT_ID is not set (see .env.example)')
  const verifier = randomString(64)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  const challenge = base64url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  )
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })
  window.location.assign(`${AUTH_URL}?${params}`)
}

/** Call once on boot: swaps a ?code= in the URL for tokens. */
export async function handleRedirect(): Promise<boolean> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  if (error) {
    history.replaceState({}, '', url.pathname)
    throw new Error(`Spotify auth error: ${error}`)
  }
  if (!code) return false

  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  history.replaceState({}, '', url.pathname)
  if (!verifier || !CLIENT_ID) return false

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`)
  writeTokens(await res.json())
  sessionStorage.removeItem(VERIFIER_KEY)
  return true
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = readTokens()
  if (!tokens) return null
  if (Date.now() < tokens.expires_at) return tokens.access_token
  if (!tokens.refresh_token || !CLIENT_ID) {
    logout()
    return null
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  })
  if (!res.ok) {
    logout()
    return null
  }
  return writeTokens(await res.json()).access_token
}
