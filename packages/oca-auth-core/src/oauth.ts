import { DEFAULT_IDCS_CLIENT_ID, DEFAULT_IDCS_URL } from "./constants"
import type { OAuthConfigInput, TokenResponse } from "./types"

const normalizeUrl = (value: string) => value.replace(/\/+$/, "")

const nonEmpty = (value?: string) => {
  const next = value?.trim()
  return next ? next : undefined
}

const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

const readTokenError = async (response: Response) => {
  const type = response.headers.get("content-type") ?? ""
  if (type.includes("application/json")) {
    const payload = (await response.json().catch(() => undefined)) as
      | {
          error?: string
          error_description?: string
          message?: string
        }
      | undefined
    if (payload) {
      const detail = payload.error_description ?? payload.message
      if (payload.error && detail) return `${payload.error}: ${detail}`
      if (payload.error) return payload.error
      if (detail) return detail
    }
  }

  const text = await response.text().catch(() => "")
  if (!text) return
  const compact = text.replace(/\s+/g, " ").trim()
  if (!compact) return
  return compact.slice(0, 240)
}

export function resolveOauthConfig(
  value?: OAuthConfigInput,
  env: Record<string, string | undefined> = process.env,
) {
  const idcsUrl =
    nonEmpty(value?.enterpriseUrl) ?? nonEmpty(env.OCA_IDCS_URL) ?? DEFAULT_IDCS_URL
  const clientId =
    nonEmpty(value?.accountId) ?? nonEmpty(env.OCA_CLIENT_ID) ?? DEFAULT_IDCS_CLIENT_ID
  return {
    idcsUrl: normalizeUrl(idcsUrl),
    clientId,
  }
}

export async function refreshAccessToken(
  idcsUrl: string,
  clientId: string,
  refresh: string,
): Promise<TokenResponse> {
  const base = normalizeUrl(idcsUrl)
  if (!isHttpUrl(base)) {
    throw new Error(`Invalid IDCS URL: ${idcsUrl}`)
  }

  const response = await fetch(`${base}/oauth2/v1/token`, {
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

  if (!response.ok) {
    const detail = await readTokenError(response)
    throw new Error(
      detail
        ? `Token refresh failed: ${response.status} (${detail})`
        : `Token refresh failed: ${response.status}`,
    )
  }

  return (await response.json()) as TokenResponse
}

export async function exchangeCodeForTokens(
  idcsUrl: string,
  clientId: string,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<TokenResponse> {
  const base = normalizeUrl(idcsUrl)
  if (!isHttpUrl(base)) {
    throw new Error(`Invalid IDCS URL: ${idcsUrl}`)
  }

  const response = await fetch(`${base}/oauth2/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  })

  if (!response.ok) {
    const detail = await readTokenError(response)
    throw new Error(
      detail
        ? `Token exchange failed: ${response.status} (${detail})`
        : `Token exchange failed: ${response.status}`,
    )
  }

  return (await response.json()) as TokenResponse
}
