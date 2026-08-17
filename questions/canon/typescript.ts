import type { RapidFireSet } from '@/lib/problems/types'

/**
 * Eight rather than twelve, deliberately.
 *
 * TypeScript is rarely screened on its own — it turns up as two or three
 * questions inside a JavaScript or React round. A short set is the honest shape,
 * and padding it out to match the others would have meant inventing questions
 * nobody asks.
 */
export const typescriptFundamentals: RapidFireSet = {
  slug: 'drill-typescript',
  title: 'TypeScript',
  difficulty: 'easy',
  topics: ['typescript', 'types'],
  blurb: 'The short set — TypeScript is usually two or three questions inside another round.',
  seconds: 60,
  questions: [
    {
      id: 'why-typescript',
      prompt: 'What does TypeScript buy you over JavaScript?',
      topic: 'types',
      expectedPoints: [
        'errors caught at compile time rather than at runtime',
        'refactoring at scale and real editor intelligence — rename a field and the compiler walks you to every use',
        'the types vanish at runtime; it compiles to JavaScript and enforces nothing once running',
      ],
    },
    {
      id: 'any-vs-unknown',
      prompt: 'any versus unknown.',
      topic: 'types',
      expectedPoints: [
        'any opts out of checking entirely and spreads silently through whatever touches it',
        'unknown is the safe top type: you can hold anything in it but must narrow before using it',
      ],
    },
    {
      id: 'interface-vs-type',
      prompt: 'interface versus type alias.',
      topic: 'types',
      expectedPoints: [
        'largely interchangeable for object shapes; interface supports declaration merging and reads idiomatically with extends',
        'type is what you need for unions, intersections, and mapped or conditional types',
      ],
    },
    {
      id: 'discriminated-union',
      prompt:
        'How do you model a value that is loading, or loaded with data, or failed with an error?',
      topic: 'narrowing',
      expectedPoints: [
        'a discriminated union: one member per state, each with a shared literal tag such as a `kind` or `status` field',
        'switching on that tag narrows the type, so the compiler knows `data` exists only in the loaded branch',
        'the win over three optional fields is that impossible combinations — loading with an error — cannot be written',
      ],
    },
    {
      id: 'generics',
      prompt: 'What are generics for? Give an example.',
      topic: 'generics',
      expectedPoints: [
        'a type parameter lets one function or component work over many types without losing the type',
        'a concrete example: a first(arr: T[]): T, or a table component generic over its row type so the column accessors are checked',
      ],
    },
    {
      id: 'utility-types',
      prompt: 'Name a few utility types and what you use them for.',
      topic: 'types',
      expectedPoints: [
        'two or more named correctly from Partial, Pick, Omit, Record, ReturnType, Required or Readonly',
        'what each is actually for — for example Omit to derive a client-safe shape by removing fields, or Record to type a lookup by key',
      ],
    },
    {
      id: 'strict-null-checks',
      prompt: 'What does strictNullChecks do?',
      topic: 'types',
      expectedPoints: [
        'null and undefined stop being assignable to everything and become types you must handle',
        'it forces you to deal with absence at the point it can occur, which catches more real bugs than any other flag',
      ],
    },
    {
      id: 'enum-vs-literal',
      prompt: 'Enum or a union of string literals?',
      topic: 'types',
      expectedPoints: [
        'a union of literals is usually preferred: no runtime output, and it is just the strings',
        'an enum generates a runtime object, and a numeric enum accepts any number, which quietly loses the safety',
      ],
    },
  ],
}
