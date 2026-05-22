import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are "it's_not_me_its_you" — a witty, observant friend who's read someone's WhatsApp chats and is about to roast them with love. Your name is the punchline of the dynamic you're diagnosing.

LANGUAGE RULES (very important):
- The chat data may be in ANY language (English, Spanish, Hindi, Hinglish, Arabic, French, Portuguese, Russian, etc.). You understand all of it.
- Your output is ALWAYS in clear, fluent ENGLISH. Never write the response in the chat's original language, even if asked.
- When quoting a phrase, name, or term of endearment from the chat (e.g. "jaan", "mi amor", "cariño", "habibi"), keep it in the original and add a brief English gloss in parentheses the first time, e.g. "jaan (sweetheart)". This preserves flavor without alienating the reader.
- If the data shows keyword-based sentiment was unreliable (e.g. detectedLanguage.keywordSupport is false, or the language is Chinese/Japanese/Korean/Thai), DO NOT make claims about positive/negative topics or sentiment trends. Stick to the structural stats: timing, response speed, ghosting, double-texts, message length, vocab crossover, emoji personality.

Your job: take a JSON dump of relationship statistics and write a 3-paragraph narrative that's:
- Funny but caring (think: best friend on a rooftop with wine, not Twitter trolls)
- Specific — quote the actual numbers, names, emojis, hours, topics from the data
- Honest about red flags but never cruel or moralizing
- Light on advice. Heavy on observation.
- Zero clichés like "communication is key"
- No headers, no bullets, no emojis at the start of paragraphs. Just three flowing paragraphs.

Paragraph 1 — The vibe: who they are as a chat duo, when they shine, what their "main character energy" looks like together.
Paragraph 2 — The receipts: the specific patterns the data exposes — apologies, ghosting, sunday scaries, who double-texts, who picks up whose phrases. Be specific.
Paragraph 3 — The verdict: a one-line "diagnosis" of the dynamic, then a warm, slightly cheeky sign-off.

Keep total length around 300-450 words. No preamble, no "here's your roast" — just the three paragraphs. Output is always in English.`;

const ONE_LINER_SYSTEM =
  'You write a single witty one-line "diagnosis" of a relationship based on chat stats. The chat may be in any language but YOUR OUTPUT IS ALWAYS IN ENGLISH. No quotes around it. Max 14 words. Tone: clever friend, not a horoscope.';

// Detect which Claude transport to use, in order of preference:
//   1. Salesforce / corporate gateway (ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL)
//      — usually configured by Claude Code itself, no key needed
//   2. AWS Bedrock (CLAUDE_CODE_USE_BEDROCK=1)
//   3. Direct Anthropic (ANTHROPIC_API_KEY)
function buildClient() {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (authToken && baseURL) {
    return {
      client: new Anthropic({ baseURL, authToken, apiKey: authToken }),
      mode: 'gateway',
    };
  }

  if (apiKey) {
    return { client: new Anthropic({ apiKey }), mode: 'anthropic-direct' };
  }

  throw new Error(
    'No Claude credentials found. Set ANTHROPIC_API_KEY in .env, or run inside an environment ' +
      'that exposes ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL (e.g. Claude Code with a configured gateway).'
  );
}

function pickModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
}

function extractText(resp) {
  return (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function sampleMessagesForContext(messages, n = 30) {
  // Spread the sample across the timeline so Claude gets early/middle/late
  // flavor rather than only the first or last 30 messages.
  if (!messages || !messages.length) return [];
  if (messages.length <= n) return messages;
  const step = messages.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(messages[Math.floor(i * step)]);
  return out;
}

function formatMessageSample(messages) {
  return messages
    .map((m) => {
      const stamp = m.timestamp instanceof Date ? m.timestamp.toISOString().replace('T', ' ').slice(0, 16) : '';
      const text = (m.text || '').slice(0, 200);
      return `[${stamp}] ${m.sender}: ${text}`;
    })
    .join('\n');
}

export async function generateNarrative(stats, messages = []) {
  const { client } = buildClient();
  const model = pickModel();

  const sample = sampleMessagesForContext(messages, 30);
  const sampleBlock = sample.length
    ? `\n\nA spread of ${sample.length} sample messages from the chat (use them for tone and flavor — the chat may be in a non-English language; translate or gloss as needed for the English narrative):\n\n\`\`\`\n${formatMessageSample(sample)}\n\`\`\``
    : '';

  const userMsg = `Here are the stats from the chat. Write the 3-paragraph narrative IN ENGLISH.${sampleBlock}\n\nStats:\n\`\`\`json\n${JSON.stringify(
    stats,
    null,
    2
  )}\n\`\`\``;

  const resp = await client.messages.create({
    model,
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });

  return extractText(resp);
}

export async function generateOneLiner(stats) {
  let client;
  try {
    ({ client } = buildClient());
  } catch {
    return null;
  }
  const model = pickModel();

  const compact = {
    participants: stats.meta.participants,
    messagesPerDay: stats.meta.messagesPerDay,
    speedDelta: stats.speedDelta,
    ghosting: stats.ghosting.events,
    apologies: Object.fromEntries(
      Object.entries(stats.perSender).map(([k, v]) => [k, v.apologies])
    ),
    doubleTexts: Object.fromEntries(
      Object.entries(stats.perSender).map(([k, v]) => [k, v.doubleTexts])
    ),
  };

  const resp = await client.messages.create({
    model,
    max_tokens: 80,
    system: ONE_LINER_SYSTEM,
    messages: [{ role: 'user', content: `Stats:\n${JSON.stringify(compact, null, 2)}` }],
  });

  return extractText(resp);
}
