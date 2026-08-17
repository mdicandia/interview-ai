import type { RapidFireSet } from '@/lib/problems/types'

/**
 * The set that cost the OMNESOFT screen, in close to the order it was asked.
 *
 * The first five here are the five actually put to me in that call — linked list
 * and queue, interface versus abstract class, why multiple interfaces but single
 * inheritance, dependency injection, and Task versus Thread. They are transcribed
 * from the answers that should have been given, not re-derived.
 *
 * The app runs no C#, and does not need to: none of this is a coding round. What
 * was being screened was whether the words come out in sixty seconds.
 */
export const csharpFundamentals: RapidFireSet = {
  slug: 'drill-csharp',
  title: 'C# and .NET fundamentals',
  difficulty: 'medium',
  topics: ['c#', '.net', 'oop', 'async'],
  blurb: 'The questions from a real .NET screen, in roughly the order they came.',
  seconds: 60,
  questions: [
    {
      id: 'linked-list',
      prompt: 'What is a linked list, and how does it differ from an array?',
      topic: 'data structures',
      expectedPoints: [
        'each node holds a value and a pointer to the next, so the elements are not contiguous in memory',
        'inserting or removing is O(1) once you are at the position, because you only rewire pointers, but reaching element N is O(n) because you walk the chain',
        'an array is the mirror image: O(1) access by index, O(n) to insert in the middle',
      ],
    },
    {
      id: 'queue',
      prompt: 'What is a queue, and where would you actually meet one?',
      topic: 'data structures',
      expectedPoints: [
        'first in, first out: enqueue at the back, dequeue from the front, both O(1)',
        'a real use: background jobs, breadth-first traversal, or a message broker such as RabbitMQ or Kafka',
        'a stack is the sibling — last in, first out, for call stacks and undo',
      ],
    },
    {
      id: 'interface-vs-abstract',
      prompt: 'Difference between an interface and an abstract class.',
      topic: 'oop',
      expectedPoints: [
        'an interface is a contract with no instance state; an abstract class is a partial implementation that can hold fields, a constructor and concrete methods',
        'a class can implement many interfaces but inherit only one class',
        'interface for a capability, abstract class for a family of related types that share code',
      ],
    },
    {
      id: 'diamond-problem',
      prompt:
        'Why does .NET let you implement many interfaces but inherit from only one class?',
      topic: 'oop',
      expectedPoints: [
        'the diamond problem: two base classes carrying state and an implementation of the same member leave the object layout and the constructor chain ambiguous',
        'interfaces carry no instance state, so implementing five of them is five promises and you write the single implementation',
        'if two interfaces declare the same member you can disambiguate with explicit interface implementation',
      ],
    },
    {
      id: 'dependency-injection',
      prompt: 'What is dependency injection, and what are the lifetimes in ASP.NET Core?',
      topic: 'dependency injection',
      expectedPoints: [
        'a class receives its dependencies from outside — usually through the constructor — instead of constructing them itself',
        'it buys loose coupling and testability: depend on the abstraction, inject a fake in tests',
        'transient is a new instance per resolution, scoped is one per HTTP request, singleton is one for the life of the app; injecting a scoped service into a singleton captures it forever and is the classic bug',
      ],
    },
    {
      id: 'task-vs-thread',
      prompt: 'What is the difference between a Task and a Thread?',
      topic: 'async',
      expectedPoints: [
        'a thread is an OS construct with its own stack, scheduled by the operating system and expensive to create; a Task is an abstraction for an operation that completes in the future',
        'a Task does not necessarily have a thread — an awaited I/O operation occupies none while it waits, which is how a server handles thousands of concurrent requests on a handful of threads',
        'in modern .NET you write async methods returning Tasks and never create raw threads',
      ],
    },
    {
      id: 'async-await-dotnet',
      prompt:
        'What does async/await actually do, and why should you never call .Result in an ASP.NET controller?',
      topic: 'async',
      expectedPoints: [
        'await releases the thread back to the pool while the I/O completes, rather than blocking it',
        'calling .Result or .Wait() blocks the thread, so the benefit is thrown away and the thread pool starves under load',
        'it can also deadlock where a synchronization context is involved; async all the way up is the rule',
      ],
    },
    {
      id: 'value-vs-reference',
      prompt: 'Value types versus reference types in C#.',
      topic: 'types',
      expectedPoints: [
        'a value type such as a struct or an int is copied on assignment; a class instance is a reference, so both names point at the same object',
        'reference types live on the heap and are garbage collected; value types are inline or on the stack',
        'boxing is wrapping a value type as an object, which allocates',
      ],
    },
    {
      id: 'linq-deferred',
      prompt: 'What is LINQ, and what does deferred execution mean?',
      topic: 'linq',
      expectedPoints: [
        'a declarative query syntax over collections — Select, Where, GroupBy, OrderBy',
        'the query is not run when it is written; it runs when it is enumerated, so ToList or a foreach is what triggers it',
        'a practical consequence: enumerating twice runs it twice, and over EF Core a query built lazily may hit the database later than you expect',
      ],
    },
    {
      id: 'middleware',
      prompt: 'What is middleware in ASP.NET Core?',
      topic: 'asp.net',
      expectedPoints: [
        'an ordered pipeline where each component sees the request, may act on it, and passes to the next — and sees the response on the way back',
        'order matters: authentication before authorization, error handling near the outside',
        'cross-cutting concerns live there: logging, auth, exception handling, CORS',
      ],
    },
    {
      id: 'layered-architecture',
      prompt: 'How do you organise an ASP.NET API? Walk me through the layers.',
      topic: 'architecture',
      expectedPoints: [
        'controller, service, repository, database — the controller does HTTP only, the service holds business rules, the repository hides data access',
        'the point is separation of concerns: the service knows nothing about HTTP or SQL, so a background job can call it and a test can run it',
        'DTOs are deliberately separate from entities, so the API contract is not the table design',
      ],
    },
    {
      id: 'ef-core',
      prompt: 'What is Entity Framework, and what do you watch out for with it?',
      topic: 'orm',
      expectedPoints: [
        'an ORM mapping classes to tables, translating LINQ into SQL',
        'the N+1 trap: lazily loading a related entity per row instead of including it in one query',
        'know when to drop to raw SQL, and that DbContext is already a repository and a unit of work — a Repository on top of it is often redundant',
      ],
    },
  ],
}
