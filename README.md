# 💔 it's_not_me_its_you

> Drop in your WhatsApp chat export. Get a dark-themed relationship dashboard
> as a downloadable PDF, complete with a Claude-written roast.

A Claude Code skill (also a standalone Node.js CLI) that ingests one or more
WhatsApp `.txt` exports, computes a deeply specific set of stats about the
conversation dynamics, asks Claude for a witty 3-paragraph diagnosis, and
saves a self-contained PDF dashboard you can share with anyone.

```
🟢 Green Zone   best days/times, top engagement topics, longest positive streaks, who initiates more
🔴 Red Zone     cold-reply topics, danger hours, Sunday Scaries Index, ghosting tally
😂 Funny Stats  emoji personality, double-text leader, sorry champion, GM reliability, novelist vs one-liner, vocab crossover
🤖 Diagnosis    a 3-paragraph roast/analysis written by Claude
```

---

## Table of contents

1. [Quick start](#quick-start)
2. [How it works](#how-it-works)
3. [The pipeline in detail](#the-pipeline-in-detail)
4. [What gets computed](#what-gets-computed)
5. [Project layout](#project-layout)
6. [Configuration](#configuration)
7. [Privacy](#privacy)
8. [Using as a Claude Code skill](#using-as-a-claude-code-skill)
9. [Known limits](#known-limits)
10. [License](#license)

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/AdityaBanda/its-not-me-its-you.git
cd its-not-me-its-you
npm install
```

Requires Node.js **18+**. `npm install` downloads a bundled Chromium
(~170MB, one-time) for PDF rendering via puppeteer.

### 2. Configure your `.env`

```bash
cp .env.example .env
```

Fill in **Claude credentials** (see [Configuration](#configuration) for details).

### 3. Export a WhatsApp chat

In WhatsApp:

- **Mobile**: open the chat → tap the contact name → scroll → **Export Chat** → **Without Media**
- **Desktop**: open the chat → menu → **Export Chat** → **Without Media**

Save the resulting `.txt` file somewhere you can find it.

### 4. Run

```bash
node run.js path/to/_chat.txt
```

Or pass multiple files for group dynamics or multi-chat reports:

```bash
node run.js chat-with-alex.txt chat-with-jordan.txt
```

If you don't pass any arguments, the CLI prompts for paths interactively.

When done, you'll see:

```
  ╭─────── your report ───────╮
  📄 PDF:  /Users/.../out/inmiy-1779480549292.pdf
  🌐 HTML: file:///Users/.../out/inmiy-1779480549292.html
  ╰───────────────────────────╯
```

The PDF auto-opens. Share it with whoever you want.

### Flags

| Flag | Purpose |
| --- | --- |
| `--no-ai` | Skip the Claude narrative (faster iteration on visuals; no API call) |
| `--no-open` | Don't auto-launch the PDF viewer |
| `--html-only` | Skip PDF generation entirely (just emits HTML) |

---

## How it works

At a high level, the tool turns a `.txt` chat log into a self-contained PDF
in five stages:

```
   .txt files
      │
      ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────┐
│   parser    │ →  │   analyzer   │ →  │ ai_insights  │ →  │   renderer   │ →  │   pdf    │
│ (regex+date │    │ (stats only, │    │ (Claude API: │    │ (HTML +      │    │ (headless│
│  detection) │    │  no network) │    │  narrative)  │    │  inline SVG) │    │  Chrome) │
└─────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────┘
      │                  │                    │                    │                  │
   messages[]         stats{}            insights{}             HTML string         PDF file
```

Each stage's output is the single source of truth for the next. The
`analyzer` output also feeds **directly** into both the Claude prompt and
the HTML template — same numbers, no drift.

---

## The pipeline in detail

### 1. Parsing — `src/parser.js`

WhatsApp's `.txt` format is locale-dependent and surprisingly messy:

- Date formats vary by region (`12/31/24`, `31/12/24`, `2024-12-31`, etc.)
- Time formats can be 12h or 24h, with or without seconds
- Multi-line messages have no terminator — they continue until the next
  parseable timestamp
- System messages (`Messages and calls are end-to-end encrypted...`,
  `<user> joined`, deleted messages) need to be filtered

The parser:

1. Samples the first ~50 message lines and tries to disambiguate
   month-vs-day order. Any day-slot value `> 12` is a hard signal for the
   format. Falls back to a sensible default if every date is ambiguous.
2. Walks the file line by line. Each line that matches the timestamp
   regex starts a new message; everything until the next match is appended
   to the current one.
3. Filters system messages and `<Media omitted>` placeholders.
4. Returns an array of `{ timestamp, sender, text }` objects sorted
   chronologically.

When given multiple files, parsed messages are merged and re-sorted, so
group chats and split exports work transparently.

### 2. Analysis — `src/analyzer.js`

Pure, deterministic, **no network**. Takes the messages array and produces
a fat JSON blob of stats. Highlights:

- **Language detection** (`src/lang.js`) — picks one of a few language
  packs by scoring stopword frequency; controls the sentiment word list and
  question-word patterns. Falls back to a "minimal" pack that disables
  sentiment for unsupported languages.
- **Sentiment scoring** — keyword-based, not NLP. Each message gets a
  score from a curated positive/negative token list. Sarcasm escapes it.
  That's the joke.
- **Time-of-day & day-of-week heatmaps** — message counts bucketed into a
  7×24 matrix, used for the timeline chart and "best/worst time to text"
  callouts.
- **Streaks** — longest consecutive-day streaks of any messaging, and
  longest streaks of net-positive sentiment.
- **Reply-time & ghosting** — gap between consecutive messages by
  different senders. Ghosting = gaps over a threshold; the analyzer also
  tracks the median reply delta per person ("speed delta").
- **Vocab crossover** — Jaccard-ish overlap of distinctive words between
  senders. High overlap = you've started talking like each other.
- **Funny stats** — sorry champion (most apologies per 100 messages), GM
  reliability (% of days with a morning greeting), double-text leader
  (consecutive messages from the same sender without reply), novelist vs.
  one-liner (median message length per person), emoji personality (top
  emoji per person + leader counts).

The full `analyze()` output is what feeds both Claude and the renderer.

### 3. AI insights — `src/ai_insights.js`

Sends the **aggregate stats** (no raw message text) to Claude with a
prompt that asks for:

- A 3-paragraph diagnosis: warm, witty, specific to the numbers given.
- A one-line "verdict" used as the report subtitle.

Credentials are auto-detected in this order:

1. `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` (corporate/proxy gateway)
2. `ANTHROPIC_BASE_URL` only (some setups)
3. `ANTHROPIC_API_KEY` (direct Anthropic)

Model defaults to `claude-sonnet-4-6`; override with `ANTHROPIC_MODEL`.

If credentials aren't configured or `--no-ai` is set, the renderer falls
back to a placeholder paragraph and skips the API call entirely.

### 4. Rendering — `src/renderer.js`

Takes the stats + insights blob and fills `templates/report.html`. The
template is a single self-contained HTML doc with:

- Inline CSS (dark theme, system fonts only — no external requests)
- Inline SVG for every chart (no chart library, no JS dependencies)
- Inline emoji and text — no remote images

Everything is one file. The HTML works as a standalone artifact even if
you never run the PDF step.

### 5. PDF — `src/pdf.js`

Boots a headless Chromium via puppeteer, loads the HTML, and prints to
PDF at A4 with print-optimized margins. The bundled Chromium ships with
puppeteer (~170MB) so this works without a system browser install.

Output goes to `./out/inmiy-<timestamp>.pdf`. The HTML alongside it is a
backup — same content, browser-renderable.

---

## What gets computed

A sampling of what shows up on the dashboard:

### Headline numbers
- Total messages, days span, days with at least one message
- Per-person message counts, percentages, median message length
- Total emojis, total words, total questions asked

### 🟢 Green zone
- Best day of week (highest avg sentiment)
- Best time of day window (highest avg sentiment)
- Top "engagement" topics — keywords that correlate with longer threads
- Longest positive streak (consecutive net-positive days)
- Initiator ratio (who starts the day's conversation more often)

### 🔴 Red zone
- Worst day / worst time-of-day windows
- "Cold reply" topics — keywords followed by short or delayed replies
- Sunday Scaries Index — relative tone drop on Sunday evenings
- Ghosting tally — number of unreplied gaps over the threshold per person

### 😂 Funny stats
- Emoji personality — top emoji per person, plus the "emoji leader"
- Double-text leader — most consecutive messages without a reply
- Sorry champion — apologies per 100 messages
- GM reliability — fraction of days with a morning greeting
- Novelist vs. one-liner — median message length per person
- Vocab crossover — distinctive shared vocabulary score

### Time series
- Messages-per-day timeline (SVG line chart)
- Day-of-week × hour-of-day heatmap

### 🤖 Claude diagnosis
- One-line verdict (used as subtitle on the cover)
- 3-paragraph narrative — warm/funny, references the numbers above

---

## Project layout

```
its-not-me-its-you/
├── run.js                     # entry point — readline-sync prompts, ora spinners
├── package.json
├── .env.example
├── SKILL.md                   # Claude Code skill manifest
├── README.md
├── sample.txt                 # tiny example chat for testing
├── sample_es.txt              # Spanish-locale example
├── sample_hi.txt              # Hindi-locale example
├── src/
│   ├── parser.js              # WhatsApp .txt parser (multi-locale date handling)
│   ├── analyzer.js            # all stat computations (no network)
│   ├── lang.js                # language detection + per-language word packs
│   ├── ai_insights.js         # Claude API calls (narrative + one-liner)
│   ├── renderer.js            # fills templates/report.html with stats + charts
│   └── pdf.js                 # HTML → PDF via headless Chromium
└── templates/
    └── report.html            # dark, self-contained HTML template
```

---

## Configuration

All config lives in `.env`. Copy `.env.example` to start.

### Claude credentials

Pick one path:

- **Inside Claude Code** (or any environment that already exports
  `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`, e.g. a corporate AI
  gateway): you don't need to set anything. The skill auto-detects.
- **Standalone**: set `ANTHROPIC_API_KEY` (get one at
  https://console.anthropic.com/).

### Optional knobs

| Env var | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Which Claude model to use for the narrative |
| `ANTHROPIC_BASE_URL` | (unset) | Override the API endpoint (proxy/gateway) |
| `ANTHROPIC_AUTH_TOKEN` | (unset) | Bearer token for proxy/gateway flows |

No SMTP, no email — output is a local PDF you can share however you like.

---

## Privacy

Your chat files **never leave your machine**. Only aggregate stats —
message counts, sentiment scores, top emojis, topic mentions — are
serialized to JSON and sent to Claude for the narrative. The raw text of
any individual message stays local.

If you'd rather not send anything to Claude at all, run with `--no-ai`.
The dashboard still renders; only the AI narrative is replaced with a
placeholder.

---

## Using as a Claude Code skill

This repo doubles as a Claude Code skill. To use it that way:

1. Symlink (or copy) the folder into your skills directory:

   ```bash
   ln -s "$PWD" ~/.claude/skills/its-not-me-its-you
   ```

2. Restart Claude Code.

3. In any conversation, hand Claude a `.txt` chat export and say
   "it's not me, it's you" or `/its-not-me-its-you`. Claude reads
   `SKILL.md`, runs `run.js` for you, and shows you the PDF path.

The skill's trigger words are listed in `SKILL.md`:

- "it's not me, it's you" / `/its-not-me-its-you`
- handing over a WhatsApp `.txt` and asking for analysis
- asking for a chat / relationship / friendship dashboard
- asking for a "vibe check" on a conversation

---

## Known limits

- **WhatsApp only.** iMessage / Telegram / Signal exports use different
  formats. New parsers welcome.
- **Date ambiguity.** WhatsApp exports use locale-dependent date formats.
  The parser auto-detects per file by sampling unambiguous dates (any day
  > 12 in a slot is a hard signal). If your timeline chart looks weird,
  that's where the bug is.
- **Sentiment is keyword-based.** No "actual NLP" — just a curated list of
  positive/negative tokens. Sarcasm escapes it. So does most teen slang.
  That's the joke.
- **Group chats degrade some pairwise stats.** Vocab crossover and reply
  deltas are designed for 1-on-1; in groups, they're computed against
  "everyone else combined" rather than per-pair.
- **Media is skipped.** WhatsApp exports show `<Media omitted>` for any
  attachment, so the analyzer treats those messages as content-free.

---

## License

MIT. Roast responsibly.
