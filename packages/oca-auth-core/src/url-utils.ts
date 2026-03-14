export const normalizeUrl = (value: string) => value.replace(/\/+$/, "")

export const nonEmpty = (value?: string) => {
  const next = value?.trim()
  return next ? next : undefined
}

export const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

export const isSafeBaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return false
    const host = url.hostname.replace(/^\[|\]$/g, "")
    if (url.protocol === "http:" && host !== "127.0.0.1" && host !== "localhost") {
      return false
    }
    // Block private, loopback, link-local, and reserved IP ranges
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false
    if (host === "0.0.0.0" || host === "::1" || host === "::") return false
    if (/^(fc|fd)[0-9a-f]{2}:/i.test(host)) return false // IPv6 ULA
    if (/^::ffff:/i.test(host)) return false // IPv4-mapped IPv6
    return true
  } catch {
    return false
  }
}

/** Validates an IDCS URL: must be HTTPS (or localhost HTTP), and not a private/reserved IP. */
export const isSafeIdcsUrl = (value: string): boolean => {
  if (!isSafeBaseUrl(value)) return false
  try {
    const url = new URL(value)
    // IDCS URL must be HTTPS (except localhost for testing)
    if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return false
    }
    return true
  } catch {
    return false
  }
}

/** Returns true if the URL hostname is a trusted domain for sending bearer tokens. */
export const isTrustedTokenDomain = (value: string): boolean => {
  try {
    const host = new URL(value).hostname.toLowerCase()
    if (host === "127.0.0.1" || host === "localhost") return true
    if (host.endsWith(".oraclecloud.com")) return true
    return false
  } catch {
    return false
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
