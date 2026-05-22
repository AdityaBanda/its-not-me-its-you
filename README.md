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

## Setup

### 1. Clone and install

```bash
git clone <this-repo> its_not_me_its_you
cd its_not_me_its_you
npm install
```

Requires Node.js **18+**. `npm install` downloads a bundled Chromium
(~170MB, one-time) for PDF rendering.

### 2. Configure your `.env`

```bash
cp .env.example .env
```

Fill in **Claude credentials**:

- **Inside Claude Code** (or any environment that already exports
  `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`, e.g. a corporate AI
  gateway): you don't need to set anything. The skill auto-detects.
- **Standalone**: set `ANTHROPIC_API_KEY` (get one at
  https://console.anthropic.com/).

No SMTP, no email — output is a local PDF you can share however you like.

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

If you don't pass any arguments, the CLI prompts for paths.

When done, you'll see:

```
  ╭─────── your report ───────╮
  📄 PDF:  /Users/.../out/inmiy-1779480549292.pdf
  🌐 HTML: file:///Users/.../out/inmiy-1779480549292.html
  ╰───────────────────────────╯
```

The PDF auto-opens. Share it with whoever you want.

### Flags

- `--no-ai` — skip the Claude narrative (faster iteration on visuals)
- `--no-open` — don't auto-launch the PDF viewer
- `--html-only` — skip PDF generation entirely (just emits HTML)

---

## Project layout

```
its_not_me_its_you/
├── run.js                     # entry point — readline-sync prompts, ora spinners
├── package.json
├── .env.example
├── SKILL.md                   # Claude Code skill manifest
├── README.md
├── src/
│   ├── parser.js              # WhatsApp .txt parser (multi-locale date handling)
│   ├── analyzer.js            # all stat computations
│   ├── ai_insights.js         # Claude API calls (narrative + one-liner)
│   ├── renderer.js            # fills templates/report.html with stats + charts
│   └── pdf.js                 # HTML → PDF via headless Chromium
└── templates/
    └── report.html            # dark, self-contained HTML template
```

---

## Privacy

Your chat files **never leave your machine**. Only aggregate stats — message
counts, sentiment scores, top emojis, topic mentions — are serialized to
JSON and sent to Claude for the narrative. The raw text of any individual
message stays local.

If you'd rather not send anything to Claude at all, run with `--no-ai`.

---

## Why a skill?

Because asking your AI assistant to "run it's_not_me_its_you on this chat
I just exported" should Just Work. Drop this folder under your skills
directory, and it does.

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

---

## License

MIT. Roast responsibly.
