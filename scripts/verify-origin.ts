import { isAllowedOrigin } from '../lib/security/origin'

let failures = 0
function check(ok: boolean, label: string) {
  console.log(`  ${ok ? '\x1b[32m✓' : '\x1b[31m✗'}\x1b[0m ${label}`)
  if (!ok) failures++
}

delete process.env.ALLOWED_ORIGINS

check(isAllowedOrigin(undefined), 'no origin (curl, scripts) is allowed')
check(isAllowedOrigin('http://localhost:3000'), 'localhost is allowed')
check(isAllowedOrigin('http://127.0.0.1:3000'), '127.0.0.1 is allowed')
check(isAllowedOrigin('http://[::1]:3000'), '[::1] is allowed')
check(!isAllowedOrigin('https://evil.example'), 'a foreign site is refused')
check(!isAllowedOrigin('http://localhost.evil.example'), 'a lookalike host is refused')
check(!isAllowedOrigin('http://192.168.1.20:3000'), 'a LAN address is refused')
check(!isAllowedOrigin('null'), 'the opaque "null" origin is refused')
check(!isAllowedOrigin('file:///x'), 'a non-http scheme is refused')

process.env.ALLOWED_ORIGINS = 'https://practice.example, https://other.example'
check(isAllowedOrigin('https://practice.example'), 'a listed origin is allowed')
check(!isAllowedOrigin('https://practice.example.evil.example'), 'a listed origin is matched exactly')

if (failures) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\n\x1b[32mAll origin checks passed.\x1b[0m')
