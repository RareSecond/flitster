const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim()
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SESSION_KEY = 'flitster.web-player.session'
const LOGIN_KEY = 'flitster.web-player.login'
const redirectUri = () => new URL('/', window.location.href).href

export const spotifyConfigured = Boolean(CLIENT_ID)

type Tokens = { access_token: string; refresh_token?: string; expires_in: number }
type Session = { accessToken: string; refreshToken?: string; expiresAt: number }
type Login = { verifier: string; state: string }

const randomString = () => base64url(crypto.getRandomValues(new Uint8Array(32)))
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function readSession(): Session | null {
  return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')
}

export async function loginToSpotify() {
  if (!CLIENT_ID) throw new Error('Set VITE_SPOTIFY_CLIENT_ID to connect Spotify.')
  const verifier = randomString()
  const state = randomString()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  sessionStorage.setItem(LOGIN_KEY, JSON.stringify({ verifier, state } satisfies Login))
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: 'streaming user-read-email user-read-private user-modify-playback-state',
    state,
    code_challenge_method: 'S256',
    code_challenge: base64url(new Uint8Array(digest)),
  })
  window.location.assign(`https://accounts.spotify.com/authorize?${params}`)
}

async function exchangeToken(params: Record<string, string>): Promise<Tokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ ...params, client_id: CLIENT_ID ?? '' }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error('Spotify authorization failed. Disconnect and connect Spotify again.')
  return response.json()
}

function saveSession(tokens: Tokens, previousRefreshToken?: string) {
  const session: Session = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previousRefreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000 - 30_000,
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session.accessToken
}

let initialSession: Promise<boolean> | undefined
export function restoreSpotifySession() {
  return initialSession ??= completeLogin()
}

async function completeLogin() {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const login: Login | null = JSON.parse(sessionStorage.getItem(LOGIN_KEY) ?? 'null')
  if (login && (code || error)) {
    const state = url.searchParams.get('state')
    sessionStorage.removeItem(LOGIN_KEY)
    for (const key of ['code', 'error', 'error_description', 'state']) url.searchParams.delete(key)
    history.replaceState(history.state, '', url)
    if (state !== login.state) throw new Error('Spotify sign-in could not be verified. Connect again.')
    if (!code || error) throw new Error('Spotify sign-in was cancelled or denied.')
    saveSession(await exchangeToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: login.verifier,
    }))
  }
  return Boolean(readSession())
}

let refresh: Promise<string> | undefined
export function disconnectSpotify() {
  sessionStorage.removeItem(SESSION_KEY)
}

export async function spotifyAccessToken(): Promise<string> {
  const session = readSession()
  if (!session) throw new Error('Connect Spotify to play this track.')
  if (Date.now() < session.expiresAt) return session.accessToken
  if (!session.refreshToken) throw new Error('Spotify authorization expired. Disconnect and connect again.')
  const refreshToken = session.refreshToken
  refresh ??= exchangeToken({ grant_type: 'refresh_token', refresh_token: refreshToken })
    .then(tokens => {
      if (readSession()?.refreshToken !== refreshToken) throw new Error('Spotify disconnected.')
      return saveSession(tokens, refreshToken)
    })
    .finally(() => { refresh = undefined })
  return refresh
}
