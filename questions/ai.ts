import type { DiscussionProblem } from '@/lib/problems/types'
import { DISCUSSION_RUBRIC } from '@/lib/problems/types'

/**
 * The AI-engineering half of the question bank.
 *
 * Written against one belief about what the role is actually assessed on: not
 * whether you can name the parts of a transformer, but whether you can tell
 * whether the thing you shipped is working. Both questions are therefore about
 * *evidence* — measuring quality when the output is text, and choosing between
 * two approaches on grounds you can defend afterwards.
 *
 * The weak answers are written from the pattern that shows up most: fluent
 * vocabulary standing in for a decision. "We'd use RAG for freshness" is a
 * sentence anyone can produce; what separates a senior answer is knowing what it
 * costs and what it does not fix.
 */

export const llmEvalDesign: DiscussionProblem = {
  kind: 'discussion',
  format: 'system-design',
  slug: 'llm-eval-design',
  title: 'How do you know the assistant got better?',
  difficulty: 'hard',
  expectedMinutes: 20,
  topics: ['AI engineering', 'evaluation', 'LLM', 'measurement'],
  statement: `A design question about evaluating an LLM feature. No code — talk it
through.

There is no single right architecture here. What is being assessed is whether you
can make quality measurable when the output is free text.`,
  prompt:
    'You own a support assistant built on an LLM. Someone changes the prompt and ' +
    'says it is better. How do you find out whether that is true, before it ships ' +
    'to everyone?',
  expectedPoints: [
    {
      point:
        'You need a fixed evaluation set of real inputs, versioned and held constant, ' +
        'or "better" is measured against a moving target.',
      essential: true,
      weakAnswer: 'Says they would "try some examples" without pinning down which ones.',
    },
    {
      point:
        'The set must include the hard and rare cases, not just typical ones — ' +
        'regressions show up in the tail, and a set of happy-path questions will ' +
        'report every change as neutral.',
      essential: true,
    },
    {
      point:
        'Free-text output needs a grading method: exact match where the answer is ' +
        'closed, a rubric with human or model graders where it is open. Whichever is ' +
        'used has to be defined before the change, not chosen after seeing results.',
      essential: true,
      weakAnswer: 'Assumes an accuracy number exists without saying what is being compared.',
    },
    {
      point:
        'A model grader is itself a model and has to be validated against human ' +
        'labels on a sample, otherwise you have replaced an unknown with an unknown.',
      essential: true,
      weakAnswer: 'Treats "LLM as judge" as ground truth.',
    },
    {
      point:
        'Sampling is non-deterministic, so a single run of each is not a comparison. ' +
        'Fix the seed and temperature, or run repeatedly and compare distributions.',
      essential: true,
    },
    {
      point:
        'Offline results have to be confirmed online — an A/B test or a staged ' +
        'rollout against a real user-facing metric such as deflection or escalation ' +
        'rate.',
    },
    {
      point:
        'Cost and latency are part of "better". A prompt that adds four examples may ' +
        'win on quality and lose on both.',
    },
    {
      point:
        'Failures should be categorised rather than counted — refusal, hallucination, ' +
        'wrong tone and missing retrieval need different fixes, and a single score ' +
        'hides which one moved.',
    },
    {
      point:
        'The evaluation set decays: it must be refreshed from production traffic, ' +
        'and kept out of any prompt or fine-tuning data to avoid grading on what was ' +
        'trained on.',
    },
    {
      point:
        'Guardrail checks belong in the same harness — a change that improves ' +
        'helpfulness while leaking more PII is not an improvement.',
    },
  ],
  hintLadder: [
    'Suppose the change really is better. What would you be able to show someone to prove it?',
    'Where do the inputs you test against come from, and what stops that set drifting between runs?',
    'The output is a paragraph of text. What decides whether one paragraph is better than another?',
    'If a model does that grading, what makes you trust the grader?',
    'You run it twice and get different answers. What does that do to your comparison?',
  ],
  followUps: [
    'The offline numbers improve and the online metric does not move. What do you conclude?',
    'How would you catch a regression that affects one percent of traffic?',
    'What would you do differently if there were no ground-truth answers at all?',
    'How much of this would you build before the feature ships, and how much after?',
  ],
  rubric: DISCUSSION_RUBRIC['system-design'],
}

export const tradeoffRagVsFinetune: DiscussionProblem = {
  kind: 'discussion',
  format: 'trade-off',
  slug: 'tradeoff-rag-vs-finetune',
  title: 'Retrieval or fine-tuning',
  difficulty: 'medium',
  expectedMinutes: 15,
  topics: ['AI engineering', 'RAG', 'fine-tuning', 'trade-offs'],
  statement: `A trade-off question. No code — talk it through.

Both approaches are defensible. The answer being assessed is whether the choice
is made on the properties of the problem rather than on which technique is
fashionable.`,
  prompt:
    'A team wants an assistant that answers questions about their internal ' +
    'documentation. They are deciding between retrieval-augmented generation and ' +
    'fine-tuning a model on the docs. How would you choose?',
  expectedPoints: [
    {
      point:
        'They solve different problems: retrieval supplies facts at answer time, ' +
        'fine-tuning shapes behaviour, format and tone. Knowledge that changes ' +
        'belongs in retrieval.',
      essential: true,
      weakAnswer: 'Treats fine-tuning as a way to "teach the model the documents".',
    },
    {
      point:
        'Documentation changes, and retrieval updates by re-indexing while ' +
        'fine-tuning updates by retraining. Freshness alone usually settles this ' +
        'case.',
      essential: true,
    },
    {
      point:
        'Retrieval can cite its sources, which matters for a support or internal-docs ' +
        'assistant where a user needs to check the answer. A fine-tuned model cannot ' +
        'tell you where something came from.',
      essential: true,
      weakAnswer: 'Never mentions attribution or verifiability.',
    },
    {
      point:
        'Access control is far easier with retrieval — you can filter the index per ' +
        'user. Weights cannot forget that one team may not read another team’s docs.',
      essential: true,
    },
    {
      point:
        'Retrieval moves the failure mode into the retrieval layer: chunking, ' +
        'embedding quality and ranking become the thing that breaks, and a wrong ' +
        'chunk produces a confident wrong answer.',
    },
    {
      point:
        'Retrieval costs context tokens on every request; fine-tuning costs a ' +
        'training run once and less context per call. Which is cheaper depends on ' +
        'traffic.',
    },
    {
      point:
        'Fine-tuning earns its place for consistent output format, house tone, or ' +
        'a narrow task where prompt engineering has plateaued.',
    },
    {
      point:
        'They compose: a fine-tuned model that follows the house format, answering ' +
        'from retrieved context, is a normal and often the right shape.',
    },
    {
      point:
        'Start with retrieval and a strong base model, measure where it fails, and ' +
        'only then decide whether the failures are knowledge failures or behaviour ' +
        'failures.',
    },
  ],
  hintLadder: [
    'What actually changes about the system when you fine-tune, compared with when you retrieve?',
    'The documentation gets edited every week. What does each approach have to do about that?',
    'Someone reads an answer and wants to check it. What can each approach offer them?',
    'Not everyone is allowed to read every document. How does each approach handle that?',
    'What breaks in a retrieval system, and would you notice?',
  ],
  followUps: [
    'You pick retrieval and the answers are still wrong. How do you work out which stage is at fault?',
    'When would you genuinely reach for fine-tuning here?',
    'What would make you say retrieval is the wrong shape for a problem entirely?',
    'How would you decide the chunk size?',
  ],
  rubric: DISCUSSION_RUBRIC['trade-off'],
}
