import type { RapidFireSet } from '@/lib/problems/types'

/**
 * The senior-frontend script: the browser, the network, and the attacks.
 *
 * "What happens when you type a URL" is first because it is the one interviewers
 * use to find the ceiling — the answer can stop at DNS or go to the render tree,
 * and where it stops is the signal. Sixty seconds is the right clock for it.
 */
export const webFundamentals: RapidFireSet = {
  slug: 'drill-web',
  title: 'Web fundamentals and security',
  difficulty: 'medium',
  topics: ['browser', 'http', 'security', 'performance'],
  blurb: 'The browser, the network, and the attacks a senior is expected to name.',
  seconds: 60,
  questions: [
    {
      id: 'url-to-render',
      prompt: 'What happens when you type a URL and press enter?',
      topic: 'browser',
      expectedPoints: [
        'DNS resolves the host, then a TCP connection and a TLS handshake',
        'the HTTP request goes out and the server responds',
        'the browser parses the HTML into a DOM, fetches the referenced assets, builds the CSSOM, and renders — with scripts able to block along the way',
      ],
    },
    {
      id: 'cors',
      prompt: 'What is CORS, and whose restriction is it?',
      topic: 'security',
      expectedPoints: [
        'it is a browser restriction, not a server one — the request often reaches the server, and the browser refuses to hand the response to the page',
        'the server opts in with Access-Control-Allow-Origin and related headers',
        'a non-simple request gets a preflight OPTIONS first',
      ],
    },
    {
      id: 'xss',
      prompt: 'What is XSS, and how do you defend against it?',
      topic: 'security',
      expectedPoints: [
        'an attacker gets script to run inside your page, so it runs with your origin and the session of whoever is logged in',
        'escape or encode anything untrusted on output; React does this by default, which is why dangerouslySetInnerHTML is the hole',
        'defence in depth: a Content-Security-Policy, and HttpOnly cookies so a token cannot be read by script',
      ],
    },
    {
      id: 'csrf',
      prompt: 'What is CSRF, and why is it less of a worry for a token-in-header API?',
      topic: 'security',
      expectedPoints: [
        'the attacker gets the victim browser to send an authenticated request the victim did not intend',
        'it works because cookies are attached automatically by the browser',
        'a token sent in an Authorization header is not attached automatically, so the forged request arrives unauthenticated; SameSite cookies and CSRF tokens are the cookie-based defences',
      ],
    },
    {
      id: 'storage',
      prompt: 'Cookies, localStorage and sessionStorage — when do you use which?',
      topic: 'browser',
      expectedPoints: [
        'cookies are sent to the server automatically and can be HttpOnly, Secure and SameSite',
        'localStorage is readable by any script on the page, so anything in it is exposed to XSS, and it persists until cleared',
        'sessionStorage is the same but scoped to the tab',
      ],
    },
    {
      id: 'http-caching',
      prompt: 'How does HTTP caching work, and why does a deploy need new filenames?',
      topic: 'http',
      expectedPoints: [
        'Cache-Control sets how long a response may be reused; an ETag with If-None-Match lets the server answer 304 instead of resending the body',
        'a hashed filename makes the URL change whenever the content changes, so the asset can be cached immutably and forever',
        'without it a client keeps serving the old bundle from cache after a deploy',
      ],
    },
    {
      id: 'core-web-vitals',
      prompt: 'Name the Core Web Vitals and what each measures.',
      topic: 'performance',
      expectedPoints: [
        'LCP — how long until the largest content element is painted, so loading',
        'INP — how long the page takes to respond to an interaction, so responsiveness',
        'CLS — how much the layout shifts unexpectedly, so visual stability',
      ],
    },
    {
      id: 'frontend-performance',
      prompt: 'A page loads slowly. What do you look at?',
      topic: 'performance',
      expectedPoints: [
        'measure before changing anything — the network waterfall and a Lighthouse or profiler trace, to see whether it is bundle size, a slow API, or rendering',
        'bundle-side levers: code splitting and lazy routes, tree shaking, bundle analysis, image optimization',
        'render-side levers: virtualization for long lists, avoiding render-blocking resources, and debouncing expensive work',
      ],
    },
    {
      id: 'websockets-sse-polling',
      prompt: 'WebSockets, SSE or polling — how do you choose?',
      topic: 'http',
      expectedPoints: [
        'polling is a periodic fetch: simplest, works everywhere, wasteful and always a little stale',
        'SSE is a one-way server-to-client stream over plain HTTP, which is what a streaming LLM response usually uses',
        'a WebSocket is a full-duplex connection, for when the client also needs to push continuously',
      ],
    },
    {
      id: 'accessibility',
      prompt: 'What does making a modal accessible actually involve?',
      topic: 'accessibility',
      expectedPoints: [
        'move focus into the dialog when it opens and return it to the trigger when it closes',
        'trap Tab inside it while open, and close on Escape',
        'semantic markup first — a real button, a labelled dialog role — with ARIA only where the semantics do not exist',
      ],
    },
  ],
}
