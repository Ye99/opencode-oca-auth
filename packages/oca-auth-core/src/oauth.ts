import { DEFAULT_IDCS_CLIENT_ID, DEFAULT_IDCS_URL } from "./constants"
import type { OAuthConfigInput, TokenResponse } from "./types"
import { isHttpUrl, isSafeIdcsUrl, nonEmpty, normalizeUrl } from "./url-utils"

function assertTokenResponse(data: unknown): asserts data is TokenResponse {
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>).access_token !== "string" ||
    !(data as Record<string, unknown>).access_token
  ) {
    throw new Error("Token response missing or invalid access_token")
  }
}

const readTokenError = async (response: Response) => {
  const text = await response.text().catch(() => "")
  if (!text) return

  const type = response.headers.get("content-type") ?? ""
  if (type.includes("application/json")) {
    try {
      const payload = JSON.parse(text) as {
        error?: string
        error_description?: string
        message?: string
      }
      const detail = payload.error_description ?? payload.message
      if (payload.error && detail) return `${payload.error}: ${detail}`
      if (payload.error) return payload.error
      if (detail) return detail
    } catch {
      /* fall through to raw text */
    }
  }

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

async function postTokenEndpoint(
  idcsUrl: string,
  body: Record<string, string>,
  errorPrefix: string,
): Promise<TokenResponse> {
  const base = normalizeUrl(idcsUrl)
  if (!isHttpUrl(base)) {
    throw new Error(`Invalid IDCS URL: ${idcsUrl}`)
  }
  if (!isSafeIdcsUrl(base)) {
    throw new Error(`Unsafe IDCS URL (private/reserved address): ${idcsUrl}`)
  }

  const response = await fetch(`${base}/oauth2/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  })

  if (!response.ok) {
    const detail = await readTokenError(response)
    throw new Error(
      detail
        ? `${errorPrefix}: ${response.status} (${detail})`
        : `${errorPrefix}: ${response.status}`,
    )
  }

  const data = await response.json()
  assertTokenResponse(data)
  return data
}

export async function refreshAccessToken(
  idcsUrl: string,
  clientId: string,
  refresh: string,
): Promise<TokenResponse> {
  return postTokenEndpoint(
    idcsUrl,
    { grant_type: "refresh_token", refresh_token: refresh, client_id: clientId },
    "Token refresh failed",
  )
}

export async function exchangeCodeForTokens(
  idcsUrl: string,
  clientId: string,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<TokenResponse> {
  return postTokenEndpoint(
    idcsUrl,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    },
    "Token exchange failed",
  )
}
