export const DEFAULT_IDCS_URL =
  "https://idcs-9dc693e80d9b469480d7afe00e743931.identity.oraclecloud.com"
export const DEFAULT_IDCS_CLIENT_ID = "a8331954c0cf48ba99b5dd223a14c6ea"
export const OAUTH_PORT = 48801
export const OAUTH_REDIRECT_PATH = "/auth/oca"
export const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

export const DEFAULT_OCA_BASE_URLS = [
  "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm",
  "https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm",
] as const

export const MODEL_DISCOVERY_PATHS = ["/v1/model/info", "/models", "/v1/models"] as const

export const TOKEN_EXPIRY_BUFFER_MS = 60_000

/** Clamp expires_in (seconds) to [60, 86400] to guard against malicious or buggy values. */
export const clampExpiresIn = (value?: number) => Math.max(60, Math.min(value ?? 3600, 86400))
