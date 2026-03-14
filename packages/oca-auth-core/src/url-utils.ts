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
    if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return false
    }
    if (/^169\.254\./.test(url.hostname)) return false
    return true
  } catch {
    return false
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
