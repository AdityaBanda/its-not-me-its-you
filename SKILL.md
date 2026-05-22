---
name: its-not-me-its-you
description: |
  Analyzes WhatsApp chat .txt exports and produces a beautiful dark-themed PDF
  relationship dashboard with green/red zone stats, funny stats, SVG charts,
  and a Claude-written 3-paragraph roast/diagnosis. Trigger when the user
  says "it's not me, it's you", "/its-not-me-its-you", asks to analyze a
  WhatsApp export, wants a chat dashboard, or asks for a relationship/chat
  report.
metadata:
  type: workflow
  inputs:
    - one or more WhatsApp exported .txt chat files (passed as args or
      collected via interactive CLI prompt)
  outputs:
    - PDF dashboard saved locally to ./out/inmiy-<timestamp>.pdf
    - HTML version saved alongside as a backup
    - PDF auto-opens in the user's default app
  requires:
    - Claude credentials — auto-detected from ANTHROPIC_AUTH_TOKEN +
      ANTHROPIC_BASE_URL (e.g. when running inside Claude Code), OR a
      direct ANTHROPIC_API_KEY if running standalone
    - Node.js 18+ and ~170MB of disk for puppeteer's bundled Chromium
      (downloaded once on first `npm install`)
---

# It's Not Me, It's You

A self-contained Node.js skill that turns WhatsApp chat exports into a
visually stunning PDF relationship dashboard you can share with anyone.

## When to invoke

Run this skill when the user:

- says "it's not me, it's you" or runs `/its-not-me-its-you`
- hands you a WhatsApp `.txt` export (or several) and asks for analysis
- asks for a chat / relationship / friendship dashboard
- wants a "vibe check" on a conversation

## How to run

```bash
node run.js path/to/chat.txt [more.txt ...]
```

If no paths are given as args, the CLI prompts for them interactively.

When done, the skill prints two paths:

```
📄 PDF:  /…/out/inmiy-1779480549292.pdf
🌐 HTML: file:///…/out/inmiy-1779480549292.html
```

The PDF auto-opens in the user's default PDF viewer. Share that file with
anyone — it's fully self-contained.

### Flags

- `--no-ai` — skip the Claude narrative (faster iteration on visuals)
- `--no-open` — don't auto-launch the PDF viewer
- `--html-only` — skip PDF generation, output HTML only

## Pipeline

1. **`src/parser.js`** — parses WhatsApp `.txt` exports (handles multiple
   locale date formats, multi-line messages, system messages).
2. **`src/analyzer.js`** — computes all deterministic stats (green zone,
   red zone, funny stats, streaks, ghosting, vocab crossover, etc).
3. **`src/ai_insights.js`** — sends the stats JSON to Claude and asks for
   a witty 3-paragraph narrative + a one-line diagnosis.
4. **`src/renderer.js`** — fills `templates/report.html` with all the data,
   including pure-SVG charts.
5. **`src/pdf.js`** — renders the HTML to a PDF via headless Chromium
   (puppeteer).

## Privacy

Chat content stays on the user's machine. Only aggregate stats + a redacted
JSON summary are sent to Claude. The PDF + HTML report are saved locally
in `./out/` — nothing is uploaded.

## Multi-chat support

You can pass multiple `.txt` files. They're merged, sorted by timestamp,
and analyzed as a single dataset — useful for group chats or comparing
multiple conversations in one report.

## Supports / does not

- ✅ 1-on-1 WhatsApp chats (best experience — gets vocab crossover, speed delta)
- ✅ Group chats (per-person stats still work; some pairwise stats degrade)
- ❌ iMessage / Telegram / Signal exports (different formats)
- ❌ Media attachments (the export shows `<Media omitted>`; we just skip them)
