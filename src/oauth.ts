import { loadEnv } from "./env"

const DEFAULT_IDCS_URL = "https://idcs-9dc693e80d9b469480d7afe00e743931.identity.oraclecloud.com"
const DEFAULT_CLIENT_ID = "a8331954c0cf48ba99b5dd223a14c6ea"
const OAUTH_PORT = 48801
const OAUTH_REDIRECT_PATH = "/auth/oca"

type TokenResponse = {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
}

type Pkce = {
  verifier: string
  challenge: string
}

type PendingOAuth = {
  pkce: Pkce
  state: string
  idcsUrl: string
  clientId: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head><title>OpenCode - OCA Authorization Successful</title></head>
  <body>
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to OpenCode.</p>
    <script>setTimeout(() => window.close(), 2000)</script>
  </body>
</html>`

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head><title>OpenCode - OCA Authorization Failed</title></head>
  <body>
    <h1>Authorization Failed</h1>
    <p>${error}</p>
  </body>
</html>`

let oauthServer: ReturnType<typeof Bun.serve> | undefined
let pendingOAuth: PendingOAuth | undefined

const random = (length: number) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((x) => chars[x % chars.length])
    .join("")
}

const encode = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const state = () => encode(crypto.getRandomValues(new Uint8Array(32)).buffer)

const nonce = () => encode(crypto.getRandomValues(new Uint8Array(32)).buffer)

const pkce = async (): Promise<Pkce> => {
  const verifier = random(43)
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return {
    verifier,
    challenge: encode(hash),
  }
}

const redirectUri = () => `http://127.0.0.1:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`

const authorizeUrl = (idcsUrl: string, clientId: string, codes: Pkce, value: string) => {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "openid offline_access",
    code_challenge: codes.challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri(),
    state: value,
    nonce: nonce(),
  })
  return `${idcsUrl}/oauth2/v1/authorize?${params.toString()}`
}

export function oauthConfig(value?: { enterpriseUrl?: string; accountId?: string }) {
  loadEnv()
  return {
    idcsUrl: value?.enterpriseUrl ?? process.env.OCA_IDCS_URL ?? DEFAULT_IDCS_URL,
    clientId: value?.accountId ?? process.env.OCA_CLIENT_ID ?? DEFAULT_CLIENT_ID,
  }
}

export async function refreshAccessToken(idcsUrl: string, clientId: string, refresh: string): Promise<TokenResponse> {
  const response = await fetch(`${idcsUrl}/oauth2/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
    }).toString(),
  })

  if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`)
  return (await response.json()) as TokenResponse
}

export async function exchangeCodeForTokens(
  idcsUrl: string,
  clientId: string,
  code: string,
  value: string,
  verifier: string,
): Promise<TokenResponse> {
  const response = await fetch(`${idcsUrl}/oauth2/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: value,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  })

  if (!response.ok) throw new Error(`Token exchange failed: ${response.status}`)
  return (await response.json()) as TokenResponse
}

const startOAuthServer = () => {
  if (oauthServer) return
  oauthServer = Bun.serve({
    port: OAUTH_PORT,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname !== OAUTH_REDIRECT_PATH) {
        return new Response("Not found", { status: 404 })
      }

      const code = url.searchParams.get("code")
      const tokenState = url.searchParams.get("state")
      const error = url.searchParams.get("error")
      const desc = url.searchParams.get("error_description")

      if (error) {
        const message = desc || error
        pendingOAuth?.reject(new Error(message))
        pendingOAuth = undefined
        return new Response(HTML_ERROR(message), {
          headers: { "Content-Type": "text/html" },
        })
      }

      if (!code) {
        const message = "Missing authorization code"
        pendingOAuth?.reject(new Error(message))
        pendingOAuth = undefined
        return new Response(HTML_ERROR(message), {
          status: 400,
          headers: { "Content-Type": "text/html" },
        })
      }

      if (!pendingOAuth || tokenState !== pendingOAuth.state) {
        const message = "Invalid state"
        pendingOAuth?.reject(new Error(message))
        pendingOAuth = undefined
        return new Response(HTML_ERROR(message), {
          status: 400,
          headers: { "Content-Type": "text/html" },
        })
      }

      const current = pendingOAuth
      pendingOAuth = undefined
      exchangeCodeForTokens(current.idcsUrl, current.clientId, code, redirectUri(), current.pkce.verifier)
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err))

      return new Response(HTML_SUCCESS, {
        headers: { "Content-Type": "text/html" },
      })
    },
  })
}

const stopOAuthServer = () => {
  if (!oauthServer) return
  oauthServer.stop()
  oauthServer = undefined
}

const waitForOAuthCallback = (codes: Pkce, value: string, idcsUrl: string, clientId: string) => {
  return new Promise<TokenResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!pendingOAuth) return
      pendingOAuth = undefined
      reject(new Error("OAuth callback timeout"))
    }, 5 * 60 * 1000)

    pendingOAuth = {
      pkce: codes,
      state: value,
      idcsUrl,
      clientId,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

export function oauthMethod() {
  return {
    type: "oauth" as const,
    label: "Login with Oracle IDCS",
    prompts: [
      {
        type: "text" as const,
        key: "idcsUrl",
        message: "IDCS URL (Enter to use default)",
        placeholder: oauthConfig().idcsUrl,
      },
      {
        type: "text" as const,
        key: "clientId",
        message: "OAuth client ID (Enter to use default)",
        placeholder: oauthConfig().clientId,
      },
    ],
    authorize: async (inputs: Record<string, string> = {}) => {
      const idcsUrl = (inputs.idcsUrl || oauthConfig().idcsUrl).replace(/\/$/, "")
      const clientId = inputs.clientId || oauthConfig().clientId
      startOAuthServer()
      const codes = await pkce()
      const value = state()
      const callbackPromise = waitForOAuthCallback(codes, value, idcsUrl, clientId)

      return {
        url: authorizeUrl(idcsUrl, clientId, codes, value),
        instructions: "Complete authorization in your browser. This window will close automatically.",
        method: "auto" as const,
        callback: async () => {
          try {
            const tokens = await callbackPromise
            return {
              type: "success" as const,
              refresh: tokens.refresh_token ?? "",
              access: tokens.access_token,
              expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
              accountId: clientId,
              enterpriseUrl: idcsUrl,
            }
          } catch {
            return {
              type: "failed" as const,
            }
          } finally {
            stopOAuthServer()
          }
        },
      }
    },
  }
}
