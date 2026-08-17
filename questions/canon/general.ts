import type { RapidFireSet } from '@/lib/problems/types'

/**
 * The language-agnostic opening of almost every screen: OOP, SOLID, HTTP, tests.
 *
 * Easy rather than medium, and that is not a compliment to the questions — they
 * are easy to *know* and easy to fumble out loud, which is the whole reason a
 * drill exists. "Name the four pillars" is worth nothing on paper and is asked
 * constantly.
 */
export const generalFundamentals: RapidFireSet = {
  slug: 'drill-general',
  title: 'General programming',
  difficulty: 'easy',
  topics: ['oop', 'http', 'testing', 'architecture'],
  blurb: 'OOP, SOLID, HTTP and testing — the warm-up half of a screen.',
  seconds: 60,
  questions: [
    {
      id: 'oop-pillars',
      prompt: 'Name the four pillars of object-oriented programming, one line each.',
      topic: 'oop',
      expectedPoints: [
        'encapsulation — hide the internals behind an interface',
        'abstraction — expose what it does, hide how',
        'inheritance — share behaviour through an is-a relationship; polymorphism — the same call behaves differently per type',
      ],
    },
    {
      id: 'solid',
      prompt: 'Run through SOLID, one line each.',
      topic: 'oop',
      expectedPoints: [
        'single responsibility — one reason to change; open/closed — extend rather than modify',
        'Liskov substitution — a subtype must be usable wherever its base is; interface segregation — small specific interfaces over one fat one',
        'dependency inversion — depend on abstractions, which is what dependency injection implements',
      ],
    },
    {
      id: 'big-o',
      prompt: 'Give me the common complexity classes with an example of each.',
      topic: 'complexity',
      expectedPoints: [
        'O(1) a hash lookup, O(log n) a binary search, O(n) a single scan',
        'O(n log n) a good general sort, O(n²) nested loops over the same input',
        'the point of naming it: it says how the cost grows, not how fast it runs today',
      ],
    },
    {
      id: 'hash-map',
      prompt: 'How does a hash map work, and when is it not O(1)?',
      topic: 'data structures',
      expectedPoints: [
        'the key is hashed to a bucket index, so a lookup goes straight to the bucket — O(1) on average',
        'collisions are handled by chaining or probing within the bucket',
        'worst case is O(n) when everything collides; and it costs memory, which is the trade against a scan',
      ],
    },
    {
      id: 'http-codes',
      prompt: 'Which HTTP status codes do you use, and what does each mean?',
      topic: 'http',
      expectedPoints: [
        '200 OK, 201 Created, 204 No Content for successes',
        '400 bad request, 401 not authenticated, 403 authenticated but not allowed, 404 not found, 409 conflict, 422 validation failed',
        '500 for a server fault and 503 for unavailable — the split between 4xx being the caller and 5xx being you',
      ],
    },
    {
      id: 'idempotency',
      prompt: 'What does idempotent mean, and why does it matter for a payments API?',
      topic: 'http',
      expectedPoints: [
        'the same request repeated produces the same result — GET, PUT and DELETE are idempotent, POST is not',
        'retries are inevitable over a network, and without idempotency a retried charge charges twice',
        'an idempotency key lets the server recognise the repeat and return the original result rather than acting again',
      ],
    },
    {
      id: 'authn-vs-authz',
      prompt: 'Authentication versus authorization.',
      topic: 'security',
      expectedPoints: [
        'authentication is who you are — logging in, a session or a token; authorization is what you are allowed to do — roles and permissions',
        '401 means not authenticated, 403 means authenticated but not permitted',
      ],
    },
    {
      id: 'jwt',
      prompt: 'What is a JWT, and what is the catch?',
      topic: 'security',
      expectedPoints: [
        'a signed token carrying claims, which the server verifies instead of looking up a session',
        'that is the appeal — it is stateless, so any instance can verify it',
        'the catch is that it cannot easily be revoked, so you keep the expiry short and use a refresh token',
      ],
    },
    {
      id: 'test-pyramid',
      prompt: 'Unit, integration and end-to-end tests — what is each for, and how many of each?',
      topic: 'testing',
      expectedPoints: [
        'unit tests one function or class in isolation; integration tests components together, such as the API against a real database; end-to-end drives the whole system through the UI',
        'the pyramid: many unit, fewer integration, few end-to-end, because cost and flakiness rise as you go up',
      ],
    },
    {
      id: 'rest-vs-graphql',
      prompt: 'REST versus GraphQL.',
      topic: 'api design',
      expectedPoints: [
        'REST is resources and verbs, simple and cacheable at the HTTP layer, but a screen may need several round trips',
        'GraphQL is one endpoint where the client declares the shape it wants, which solves over- and under-fetching',
        'the cost is server complexity: caching, query depth and cost limiting, and N+1 in the resolvers',
      ],
    },
    {
      id: 'monolith-microservices',
      prompt: 'Monolith or microservices — how would you decide?',
      topic: 'architecture',
      expectedPoints: [
        'a monolith is one deployable; microservices are independently deployable services each owning its data',
        'what you buy is team autonomy and independent scaling',
        'what you pay is operational complexity and distributed-system problems — network failure, eventual consistency, distributed tracing — so team size and deployment pain are what should decide it, not fashion',
      ],
    },
    {
      id: 'docker',
      prompt: 'What is Docker, actually, and how does a container differ from a VM?',
      topic: 'infrastructure',
      expectedPoints: [
        'it packages an application with its dependencies into an image that runs the same anywhere',
        'a container shares the host kernel and isolates processes, so it is far lighter than a VM, which virtualises hardware and runs its own kernel',
      ],
    },
  ],
}
