import {
  OAUTH_CALLBACK_TIMEOUT_MS,
  OAUTH_PORT,
  OAUTH_REDIRECT_PATH,
} from "./constants"
import { loadEnv } from "./env"
import {
  exchangeCodeForTokens as exchangeCodeForTokensCore,
  refreshAccessToken as refreshAccessTokenCore,
  resolveOauthConfig,
  isHttpUrl,
  isSafeIdcsUrl,
  nonEmpty,
  normalizeUrl,
  clampExpiresIn,
  type OAuthConfigInput,
  type TokenResponse,
} from "../packages/oca-auth-core"

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

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head><title>OpenCode - OCA Authorization Failed</title></head>
  <body>
    <h1>Authorization Failed</h1>
    <p>${escapeHtml(error)}</p>
  </body>
</html>`

function createOAuthCallbackServer() {
  let server: ReturnType<typeof Bun.serve> | undefined
  let pending: PendingOAuth | undefined

  return {
    get pending() { return pending },
    set pending(value: PendingOAuth | undefined) { pending = value },
    get isRunning() { return server !== undefined },
    start(handler: (req: Request) => Promise<Response>) {
      if (server) return
      server = Bun.serve({
        hostname: "127.0.0.1",
        port: OAUTH_PORT,
        fetch: handler,
      })
    },
    stop() {
      if (!server) return
      server.stop()
      server = undefined
    },
  }
}

const callbackServer = createOAuthCallbackServer()

const random = (length: number) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const limit = 256 - (256 % chars.length) // 252 — reject bytes >= limit to eliminate modulo bias
  const result: string[] = []
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length - result.length))
    for (const b of bytes) {
      if (b < limit) result.push(chars[b % chars.length])
      if (result.length === length) break
    }
  }
  return result.join("")
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

export function oauthConfig(value?: OAuthConfigInput) {
  loadEnv()
  return resolveOauthConfig(value, process.env)
}

export const refreshAccessToken = refreshAccessTokenCore
export const exchangeCodeForTokens = exchangeCodeForTokensCore

async function handleOAuthCallback(req: Request): Promise<Response> {
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
    callbackServer.pending?.reject(new Error(message))
    callbackServer.pending = undefined
    return new Response(HTML_ERROR(message), {
      headers: { "Content-Type": "text/html" },
    })
  }

  if (!code) {
    const message = "Missing authorization code"
    callbackServer.pending?.reject(new Error(message))
    callbackServer.pending = undefined
    return new Response(HTML_ERROR(message), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    })
  }

  if (!callbackServer.pending || tokenState !== callbackServer.pending.state) {
    const message = "Invalid state"
    callbackServer.pending?.reject(new Error(message))
    callbackServer.pending = undefined
    return new Response(HTML_ERROR(message), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    })
  }

  const current = callbackServer.pending
  callbackServer.pending = undefined
  try {
    const tokens = await exchangeCodeForTokens(current.idcsUrl, current.clientId, code, redirectUri(), current.pkce.verifier)
    current.resolve(tokens)
    return new Response(HTML_SUCCESS, {
      headers: { "Content-Type": "text/html" },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    current.reject(err instanceof Error ? err : new Error(message))
    return new Response(HTML_ERROR(message), {
      headers: { "Content-Type": "text/html" },
    })
  }
}

const waitForOAuthCallback = (
  codes: Pkce,
  value: string,
  idcsUrl: string,
  clientId: string,
) => {
  if (callbackServer.pending) {
    callbackServer.pending.reject(new Error("Superseded by new OAuth flow"))
    callbackServer.pending = undefined
  }

  return new Promise<TokenResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!callbackServer.pending) return
      callbackServer.pending = undefined
      reject(new Error("OAuth callback timeout"))
    }, OAUTH_CALLBACK_TIMEOUT_MS)

    callbackServer.pending = {
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
      const config = oauthConfig()
      const idcsUrl = normalizeUrl(nonEmpty(inputs.idcsUrl) ?? config.idcsUrl)
      if (!isHttpUrl(idcsUrl)) {
        throw new Error(`Invalid IDCS URL: ${idcsUrl}. Use a full URL like https://idcs.example.com`)
      }
      if (!isSafeIdcsUrl(idcsUrl)) {
        throw new Error(`Unsafe IDCS URL (private/reserved address): ${idcsUrl}`)
      }
      const clientId = nonEmpty(inputs.clientId) ?? config.clientId
      callbackServer.start(handleOAuthCallback)
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
              expires: Date.now() + clampExpiresIn(tokens.expires_in) * 1000,
              accountId: clientId,
              enterpriseUrl: idcsUrl,
            }
          } catch (err) {
            console.error("[oca] OAuth callback failed:", err instanceof Error ? err.message : String(err))
            return {
              type: "failed" as const,
            }
          } finally {
            callbackServer.stop()
          }
        },
      }
    },
  }
}
