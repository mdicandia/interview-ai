const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function extraOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

// A missing origin is allowed: browsers always send one cross-site, so only curl and scripts omit it.
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true
  if (extraOrigins().includes(origin)) return true
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}
