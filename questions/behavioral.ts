import type { DiscussionProblem } from '@/lib/problems/types'
import { DISCUSSION_RUBRIC } from '@/lib/problems/types'

/**
 * The behavioural canon, and the one round built from a named rejection.
 *
 * An agency screen passed this candidate on technical ability and did not select
 * them, with one line of feedback: English is good, improve storytelling. That is
 * the only weakness anyone has said out loud, and until now the app practised
 * everything except it.
 *
 * **The expected points describe shape, not script.** They are derived from
 * prepared answers, but a prepared answer read aloud is audible in ten seconds
 * and scores worse than an unprepared one. So each point asks whether the
 * *substance* arrived — was there a specific situation, was the candidate's own
 * contribution named, did a number appear, did the thing that changed
 * permanently get said — and never whether a particular sentence did.
 *
 * Where a story is fixed (the client that churned, the disagreement about easy
 * mode) the points name its beats, because the failure mode there is leaving out
 * the number or the ending, not telling a different story.
 *
 * Half of what makes these good is not judged at all but counted: see
 * `lib/session/speech.ts`. Agency ratio, length and whether the last sentence
 * landed on a fact are mechanical, and mechanical beats a model's opinion.
 */

/** Every behavioural answer is graded against these, whatever the question. */
const UNIVERSAL: DiscussionProblem['expectedPoints'] = [
  {
    point:
      'The answer is about one specific situation with a time and a place, not a ' +
      'general description of how they usually work.',
    essential: true,
    weakAnswer: 'Describes a policy — "what I normally do is" — with no story attached.',
  },
  {
    point:
      'Their own contribution is stated in the first person. What *they* decided, ' +
      'built or changed, distinct from what the team did.',
    essential: true,
    weakAnswer: 'Everything is "we", so nothing in the answer is identifiably theirs.',
  },
  {
    point:
      'The answer ends on a fact — something that shipped, a number that moved, or a ' +
      'practice that is still in place — rather than trailing off on a document, a ' +
      'process, or a feeling.',
    essential: true,
    weakAnswer: 'Ends on "and that was a really good learning experience".',
  },
]

const STORY_RUBRIC = DISCUSSION_RUBRIC.behavioral

export const tellMeAboutYourself: DiscussionProblem = {
  kind: 'discussion',
  format: 'behavioral',
  slug: 'behavioral-about-yourself',
  title: 'Tell me about yourself',
  difficulty: 'medium',
  expectedMinutes: 5,
  topics: ['behavioural', 'narrative', 'opening'],
  statement: `The first ninety seconds of almost every screen. No code — answer it out loud.

This one is worth more practice than it looks: it sets what the rest of the
conversation is about, and it is the answer most likely to be delivered from
memory and sound like it.`,
  prompt: 'Tell me a bit about yourself.',
  expectedPoints: [
    {
      point:
        'Opens with the current role and its scope in one sentence — years in, where, ' +
        'and what they own — rather than starting at university and walking forward.',
      essential: true,
      weakAnswer: 'A chronological career history that reaches the present at minute three.',
    },
    {
      point:
        'Names one thing they are proudest of, concretely, with what it is used for or ' +
        'by how many people.',
      essential: true,
    },
    {
      point:
        'Claims the scope honestly: what they personally built, distinguished from the ' +
        'platform or team it sits inside.',
      essential: true,
      weakAnswer: 'Implies ownership of a whole product where the real scope was one part of it.',
    },
    {
      point: 'Includes something beyond the day job that is evidence rather than a hobby claim.',
    },
    {
      point:
        'Ends pointing at *them* — why this conversation, this role — instead of ending ' +
        'on themselves.',
    },
    ...UNIVERSAL.slice(2),
  ],
  hintLadder: [
    'Start again with one sentence: what do you do now, and what do you own?',
    'What is the single thing you have built that you would want them to remember?',
    'How many people use it? Say the number.',
    'You have described yourself. Now why are you talking to *this* company?',
  ],
  followUps: [
    'You said you own the data model, the API and the UI — how does that change how you work?',
    'What part of that were you personally responsible for?',
    'What would you want to be doing more of than you are now?',
  ],
  rubric: STORY_RUBRIC,
}

export const whyThisPosition: DiscussionProblem = {
  kind: 'discussion',
  format: 'behavioral',
  slug: 'behavioral-why-this-role',
  title: 'Why are you interested in this position?',
  difficulty: 'medium',
  expectedMinutes: 5,
  topics: ['behavioural', 'motivation', 'research'],
  statement: `Asked in every screen, and the one most often answered with something
that would fit any company.

For this exercise, answer it for a company you are actually talking to. The
grader is looking for specificity that only research could produce — not for
enthusiasm.`,
  prompt: 'Why are you interested in this position?',
  expectedPoints: [
    {
      point:
        'Names something specific about the company — a product, a problem, a technical ' +
        'bet — precise enough that it could not be said about a competitor.',
      essential: true,
      weakAnswer: 'Praises the mission, the culture or the growth in terms that fit any company.',
    },
    {
      point: 'Connects that specific thing to work they have actually done.',
      essential: true,
    },
    {
      point:
        'Says what they would contribute and roughly how soon, rather than what they hope ' +
        'to gain.',
      essential: true,
      weakAnswer: 'Frames the answer around learning, growth, or the opportunity for themselves.',
    },
    {
      point: 'Says something about the people or how the team builds, not only the product.',
    },
    ...UNIVERSAL.slice(1, 2),
  ],
  hintLadder: [
    'What do they build that made you apply to them rather than to someone else?',
    'What have you built that is the same shape as that problem?',
    'You have said what you would get from it. What would they get?',
    'Who would you be working with, and does that matter to you?',
  ],
  followUps: [
    'What would you want to be true about the team for you to say yes?',
    'What is the part of this role you would find hardest?',
    'What would make you turn this down?',
  ],
  rubric: STORY_RUBRIC,
}

export const recentWork: DiscussionProblem = {
  kind: 'discussion',
  format: 'behavioral',
  slug: 'behavioral-recent-work',
  title: 'What have you been working on recently?',
  difficulty: 'easy',
  expectedMinutes: 5,
  topics: ['behavioural', 'scope', 'delivery'],
  statement: `Sounds like small talk and is not. It is where an interviewer decides
how senior you are, from how you describe scope.

No code — answer it out loud.`,
  prompt: 'What have you been working on recently?',
  expectedPoints: [
    {
      point: 'Names one project and what it is for, in business terms, before any technology.',
      essential: true,
      weakAnswer: 'Opens with the stack — "it is a React app with a Node backend".',
    },
    {
      point:
        'States the breadth of their own involvement — design, data model, API, UI — rather ' +
        'than only the layer they are assumed to work in.',
      essential: true,
    },
    {
      point: 'Gives a delivery fact: when it launched, who uses it, how long it took.',
      essential: true,
    },
    {
      point:
        'Has a second, different example ready, so the same story is not carrying every ' +
        'answer in the interview.',
    },
    ...UNIVERSAL.slice(1, 2),
  ],
  hintLadder: [
    'What is the product for? Say it as a customer would.',
    'Which parts of it did you personally build?',
    'When did it ship, and who uses it?',
    'What else have you worked on that is nothing like that one?',
  ],
  followUps: [
    'What was the hardest decision in that project?',
    'What would you do differently if you started it again?',
    'Who else was involved, and what did they own?',
  ],
  rubric: STORY_RUBRIC,
}

export const disagreementWithLeadership: DiscussionProblem = {
  kind: 'discussion',
  format: 'behavioral',
  slug: 'behavioral-disagreement',
  title: 'A disagreement with your manager',
  difficulty: 'hard',
  expectedMinutes: 6,
  topics: ['behavioural', 'conflict', 'influence'],
  statement: `The question that separates "I am easy to work with" from "I have
opinions and can hold them".

Both failure modes are common: a story where the candidate was simply right, and
a story where they folded immediately. No code — answer it out loud.`,
  prompt: 'How do you handle disagreements with your manager or leadership?',
  expectedPoints: [
    {
      point: 'Tells a real disagreement, not a story where they proposed something and won.',
      essential: true,
      weakAnswer: 'Tells a persuasion story with no actual opposition in it.',
    },
    {
      point:
        "States the other person's argument fairly, and grants that it was reasonable.",
      essential: true,
      weakAnswer: 'Describes the counter-argument only well enough to knock it down.',
    },
    {
      point: 'Describes what they did *inside* the constraint once the decision went against them.',
      essential: true,
    },
    {
      point: 'Says what shipped as a result.',
      essential: true,
    },
    {
      point:
        'Still holds the original position, and says what would make the case differently ' +
        'next time — evidence, usage data, a measurement.',
    },
    {
      point:
        'The lesson is about their own case being weak, not about the other person being ' +
        'wrong.',
    },
  ],
  hintLadder: [
    'What did you actually disagree about? Be specific about the decision.',
    'What was their argument? Say it as they would have said it.',
    'The decision went against you. What did you do next?',
    'Do you still think you were right? What would you bring next time?',
  ],
  followUps: [
    'What would you have done if the constraint had not been real?',
    'How do you decide when to keep pushing and when to commit to the decision?',
    'Has the data you started collecting changed your mind at all?',
  ],
  rubric: STORY_RUBRIC,
}

export const underperformingPeer: DiscussionProblem = {
  kind: 'discussion',
  format: 'behavioral',
  slug: 'behavioral-underperforming-peer',
  title: "A peer isn't performing",
  difficulty: 'hard',
  expectedMinutes: 6,
  topics: ['behavioural', 'teamwork', 'seniority'],
  statement: `Asked to find out whether you go to the person or to their manager.

The question has two halves — what you do in general, and a time you did it — and
answers that give only the story miss half of it. No code — answer it out loud.`,
  prompt:
    "A peer isn't performing and it's starting to hurt the roadmap. What do you do?",
  expectedPoints: [
    {
      point: 'Goes to the person directly and privately first, before anyone else.',
      essential: true,
      weakAnswer: 'Escalates to a lead or manager as the first step.',
    },
    {
      point:
        'Assumes a context problem before a capability problem — missing information, ' +
        'unclear requirements — because that is usually what it is.',
      essential: true,
    },
    {
      point:
        'Flags the schedule risk early rather than letting a date slip quietly, and does so ' +
        'after having said it to the person first.',
      essential: true,
    },
    {
      point: 'Backs the approach with one concrete time they did it, briefly.',
      essential: true,
    },
    {
      point:
        'Made the problem concrete rather than described — a prototype, a document, ' +
        'something the other person could look at.',
    },
    {
      point: 'Quantifies what catching it early saved.',
    },
  ],
  hintLadder: [
    'Who do you talk to first?',
    'What do you assume the cause is, before you know?',
    'The roadmap is still at risk after that conversation. Now what?',
    'When did you actually do this? What happened?',
  ],
  followUps: [
    'What if the person disagrees that anything is wrong?',
    'How would you handle it differently if they were more senior than you?',
    'When is it right to take it to their manager?',
  ],
  rubric: STORY_RUBRIC,
}

export const hardestTechnicalChallenge: DiscussionProblem = {
  kind: 'discussion',
  format: 'behavioral',
  slug: 'behavioral-hardest-problem',
  title: 'The hardest technical problem you have faced',
  difficulty: 'hard',
  expectedMinutes: 7,
  topics: ['behavioural', 'debugging', 'depth'],
  statement: `The behavioural question that is really a technical one. The story has
to be genuinely hard, and you have to be able to explain *why* it was hard to
someone who was not there.

No code — answer it out loud.`,
  prompt: 'What was the most difficult technical challenge you have faced?',
  expectedPoints: [
    {
      point:
        'Says what made it hard, specifically — and the answer is not "it was a lot of work". ' +
        'Silent failure, several things interacting, no error to follow.',
      essential: true,
      weakAnswer: 'Describes something merely large or tedious rather than difficult.',
    },
    {
      point:
        'The explanation is followable by someone who has never seen the system: the pieces ' +
        'are introduced before they are used.',
      essential: true,
    },
    {
      point: 'Describes how it was narrowed down, not just what the answer turned out to be.',
      essential: true,
    },
    {
      point:
        'Names the moment the problem reframed — the measurement or observation that made ' +
        'the cause obvious.',
    },
    {
      point:
        'Says what shipped first and why that order: the cheap guard before the complete fix.',
    },
    {
      point:
        'Ends on a transferable lesson, stated as a rule they now apply rather than as a ' +
        'feeling about the experience.',
      essential: true,
    },
  ],
  hintLadder: [
    'What made it hard? Not big — hard.',
    'Assume I have never seen this system. What do I need to know first?',
    'How did you narrow it down?',
    'What did you ship first, and why that one?',
  ],
  followUps: [
    'What would have caught it earlier?',
    'What did you change about how you work afterwards?',
    'How long did the whole thing take?',
  ],
  rubric: STORY_RUBRIC,
}

export const projectThatFailed: DiscussionProblem = {
  kind: 'discussion',
  format: 'behavioral',
  slug: 'behavioral-failure',
  title: 'A project of yours that failed',
  difficulty: 'hard',
  expectedMinutes: 6,
  topics: ['behavioural', 'ownership', 'failure'],
  statement: `The question most often answered with a failure that was somebody
else's fault, or one that cost nothing.

A real answer costs the person telling it something. No code — answer it out loud.`,
  prompt: 'Tell me about a project of yours that failed.',
  expectedPoints: [
    {
      point:
        'The failure is theirs. The decision that caused it was one they made, stated ' +
        'plainly and early.',
      essential: true,
      weakAnswer: 'The cause turns out to be a stakeholder, a deadline, or a team decision.',
    },
    {
      point:
        'States what it cost — time spent, adoption, whether it was thrown away — without ' +
        'softening it.',
      essential: true,
      weakAnswer: 'Uses "essentially" or "more or less" to blunt the number.',
    },
    {
      point: 'Explains the technical shape of the mistake, so it is a lesson rather than a mood.',
      essential: true,
    },
    {
      point:
        'Says they could see it going wrong while building and kept going — the honest part ' +
        'most answers omit.',
    },
    {
      point:
        'Names one thing that changed permanently in how they work, specific enough to be ' +
        'checkable.',
      essential: true,
    },
  ],
  hintLadder: [
    'Whose decision was it?',
    'What did it cost? Say the number without softening it.',
    'What was wrong with the design, technically?',
    'What do you do differently now, specifically?',
  ],
  followUps: [
    'When could you have stopped?',
    'Did you work on the replacement? How was it different?',
    'What would have made you stop earlier?',
  ],
  rubric: STORY_RUBRIC,
}

export const demonstratedValue: DiscussionProblem = {
  kind: 'discussion',
  format: 'behavioral',
  slug: 'behavioral-company-value',
  title: 'A time you demonstrated ownership',
  difficulty: 'medium',
  expectedMinutes: 6,
  topics: ['behavioural', 'ownership', 'values'],
  statement: `Companies ask this with their own value swapped in — ownership, bias
for action, customer obsession. The story has to be chosen to fit the word they
used, which means having several ready.

This one asks for ownership. No code — answer it out loud.`,
  prompt:
    'Tell me about a time you demonstrated ownership — something nobody asked you to do.',
  expectedPoints: [
    {
      point: 'Nobody assigned it. They say so explicitly.',
      essential: true,
      weakAnswer: 'Tells a story about doing assigned work well.',
    },
    {
      point: 'Says why they picked it up — what they saw that others had not.',
      essential: true,
    },
    {
      point: 'Describes what they actually did, in enough detail to be credible.',
      essential: true,
    },
    {
      point: 'Gives the outcome as a fact: adopted, shipped, still in use, a number.',
      essential: true,
    },
    {
      point: 'The change outlived the moment — it is how things are done now.',
    },
  ],
  hintLadder: [
    'Who asked you to do it?',
    'What did you notice that nobody else had?',
    'What did you build or change?',
    'Is it still in place today?',
  ],
  followUps: [
    'How did you get other people to go along with it?',
    'What would you have done if they had said no?',
    'What did it cost you to take that on?',
  ],
  rubric: STORY_RUBRIC,
}

export const questionsForUs: DiscussionProblem = {
  kind: 'discussion',
  format: 'behavioral',
  slug: 'behavioral-questions-for-us',
  title: 'Do you have any questions for us?',
  difficulty: 'easy',
  expectedMinutes: 4,
  topics: ['behavioural', 'closing', 'research'],
  statement: `The last two minutes, and the only part of the interview you control
completely. Treated as a formality by most candidates and as a signal by most
interviewers.

Ask your questions out loud, as you would to them.`,
  prompt: 'Do you have any questions for us?',
  expectedPoints: [
    {
      point: 'Has questions ready — two or three — rather than declining or inventing one.',
      essential: true,
      weakAnswer: '"No, I think you covered everything."',
    },
    {
      point:
        'At least one question could only come from having researched them: about their ' +
        'product, their roadmap, or a technical bet they have made.',
      essential: true,
    },
    {
      point:
        'At least one is about the people or the team — how long it has been together, what ' +
        'someone who did well did differently.',
      essential: true,
    },
    {
      point:
        'The set is not all due diligence. Every question being a risk probe reads as ' +
        'suspicion rather than interest.',
      weakAnswer: 'Asks only about attrition, why the role is open, and what went wrong before.',
    },
    {
      point: 'Asks something that helps them decide, not only something that helps the candidate.',
    },
  ],
  hintLadder: [
    'You have two minutes and their full attention. What do you want to know?',
    'What did you find out about them that you want to ask about?',
    'What do you want to know about the people you would work with?',
    'Is there a question that would make them more likely to want you?',
  ],
  followUps: [
    'What answer would put you off the role?',
    'What would you ask a recruiter that you would not ask a hiring manager?',
    'Which of those matters most to you?',
  ],
  rubric: STORY_RUBRIC,
}

export const superpower: DiscussionProblem = {
  kind: 'discussion',
  format: 'behavioral',
  slug: 'behavioral-superpower',
  title: "What's your superpower?",
  difficulty: 'medium',
  expectedMinutes: 4,
  topics: ['behavioural', 'positioning'],
  statement: `A short answer that is really about whether you know what makes you
different from the other four candidates.

The trap is answering with something everyone would claim. No code — answer it
out loud.`,
  prompt: "What's your superpower?",
  expectedPoints: [
    {
      point:
        'Names something specific enough that another good engineer would not claim the ' +
        'same thing.',
      essential: true,
      weakAnswer: '"I take things from idea to production" — true of most senior engineers.',
    },
    {
      point: 'Backs it with evidence: a thing built, an outcome, a change that stuck.',
      essential: true,
    },
    {
      point: 'Explains the mechanism — *why* it produces better results, not just that it does.',
      essential: true,
    },
    {
      point: 'Does not undercut it with volunteered modesty about what they are not good at.',
      weakAnswer: 'Follows the claim with "though I am obviously not an expert in…".',
    },
    ...UNIVERSAL.slice(2),
  ],
  hintLadder: [
    'Would another senior engineer claim the same thing? Then it is not it.',
    'What have you built that proves it?',
    'Why does working that way produce a better result?',
    'Stop there. You had it, and then you took it back.',
  ],
  followUps: [
    'Where does that stop being an advantage?',
    'What is the flip side of working that way?',
    'Who have you seen do it better than you?',
  ],
  rubric: STORY_RUBRIC,
}

export const BEHAVIORAL_QUESTIONS: readonly DiscussionProblem[] = [
  tellMeAboutYourself,
  whyThisPosition,
  recentWork,
  demonstratedValue,
  disagreementWithLeadership,
  underperformingPeer,
  hardestTechnicalChallenge,
  projectThatFailed,
  questionsForUs,
  superpower,
]
