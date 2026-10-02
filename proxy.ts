import { NextResponse, type NextRequest } from 'next/server'
import { isAllowedOrigin } from '@/lib/security/origin'

// Every /api route spends a paid key; block cross-site POSTs from other web pages.
export function proxy(request: NextRequest) {
  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return NextResponse.json({ error: 'Origin not allowed.' }, { status: 403 })
  }
  return NextResponse.next()
}

export const config = { matcher: '/api/:path*' }
