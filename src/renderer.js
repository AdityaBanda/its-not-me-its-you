import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'report.html');

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtHour(h) {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// Color palette per participant — first two get distinct accent colors.
const ACCENT_COLORS = ['#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa'];

function participantCards(perSender) {
  const names = Object.keys(perSender);
  if (!names.length) return '';

  const rows = names.map((name, i) => {
    const ps = perSender[name];
    const accent = ACCENT_COLORS[i % ACCENT_COLORS.length];
    const emojiLine = ps.topEmojis.length
      ? ps.topEmojis.map((e) => `${e.key} <span style="color:#888;">×${e.value}</span>`).join('  ')
      : '<span style="color:#666;">no emoji energy</span>';

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
        <tr>
          <td style="padding:18px;background:#13131c;border:1px solid #1f1f2c;border-left:4px solid ${accent};border-radius:12px;">
            <div style="display:inline-block;font-size:18px;font-weight:800;color:#fff;">
              ${escapeHtml(name)}
            </div>
            <div style="font-size:12px;color:#888;margin-top:2px;">
              ${ps.messages.toLocaleString()} messages · ${ps.sharePct}% of all chat · ${ps.words.toLocaleString()} words
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
              <tr>
                <td width="33%" style="padding:6px 8px 6px 0;">
                  <div style="font-size:10px;color:#777;letter-spacing:1px;text-transform:uppercase;">Median reply</div>
                  <div style="font-size:16px;font-weight:700;color:#fff;">${ps.medianReplyMin} min</div>
                </td>
                <td width="33%" style="padding:6px 8px;">
                  <div style="font-size:10px;color:#777;letter-spacing:1px;text-transform:uppercase;">Avg msg length</div>
                  <div style="font-size:16px;font-weight:700;color:#fff;">${ps.avgWords} words</div>
                </td>
                <td width="34%" style="padding:6px 0 6px 8px;">
                  <div style="font-size:10px;color:#777;letter-spacing:1px;text-transform:uppercase;">Initiations</div>
                  <div style="font-size:16px;font-weight:700;color:#fff;">${ps.initiations}</div>
                </td>
              </tr>
            </table>
            <div style="margin-top:12px;font-size:14px;letter-spacing:2px;">
              ${emojiLine}
            </div>
          </td>
        </tr>
      </table>
    `;
  });

  return rows.join('\n');
}

function statRow(label, value, sub) {
  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:14px;color:#bbb;">${label}</div>
        ${sub ? `<div style="font-size:11px;color:#666;margin-top:2px;">${sub}</div>` : ''}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);text-align:right;">
        <div style="font-size:15px;font-weight:700;color:#fff;">${value}</div>
      </td>
    </tr>
  `;
}

function greenZone(stats) {
  const rows = [];
  const slots = stats.timing.bestSlots;
  if (slots.length) {
    rows.push(
      statRow(
        'Best vibes time',
        slots
          .slice(0, 2)
          .map((s) => `${s.day} · ${fmtHour(s.hour)}`)
          .join(', '),
        'highest sentiment slots with enough volume'
      )
    );
  }

  const greenTopics = stats.topics.green
    .filter((t) => t.avgSentiment >= 0)
    .slice(0, 3);
  if (greenTopics.length) {
    rows.push(
      statRow(
        'Topics that light it up',
        greenTopics.map((t) => `<span style="color:#4ade80;">${t.topic}</span>`).join(' · '),
        'highest avg sentiment'
      )
    );
  }

  if (stats.streaks.longestActiveStreak) {
    rows.push(
      statRow(
        'Longest daily streak',
        `${stats.streaks.longestActiveStreak} days`,
        stats.streaks.longestActiveStreakStart
          ? `${stats.streaks.longestActiveStreakStart} → ${stats.streaks.longestActiveStreakEnd}`
          : ''
      )
    );
  }

  if (stats.streaks.longestPositiveStreak) {
    rows.push(
      statRow(
        'Longest good-vibes streak',
        `${stats.streaks.longestPositiveStreak} days`,
        stats.streaks.longestPositiveStreakStart
          ? `${stats.streaks.longestPositiveStreakStart} → ${stats.streaks.longestPositiveStreakEnd}`
          : ''
      )
    );
  }

  // Initiations leader
  const senders = Object.keys(stats.perSender);
  if (senders.length >= 2) {
    const sorted = [...senders].sort(
      (a, b) => stats.perSender[b].initiations - stats.perSender[a].initiations
    );
    rows.push(
      statRow(
        'Conversation starter',
        `${escapeHtml(sorted[0])} (${stats.perSender[sorted[0]].initiations}× vs ${
          stats.perSender[sorted[1]].initiations
        }×)`,
        'first message after a 6h+ silence'
      )
    );
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join(
    ''
  )}</table>`;
}

function redZone(stats) {
  const rows = [];

  const redTopics = stats.topics.red
    .filter((t) => t.avgSentiment <= 0)
    .slice(0, 3);
  if (redTopics.length) {
    rows.push(
      statRow(
        'Topics that go cold',
        redTopics
          .map(
            (t) =>
              `<span style="color:#f87171;">${t.topic}</span> <span style="color:#666;">(${t.medianReplyMin}m delay)</span>`
          )
          .join(' · '),
        'longest reply gaps + lowest sentiment'
      )
    );
  }

  const dangerHours = stats.timing.dangerHours
    .map((c, h) => ({ h, c }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 3)
    .filter((s) => s.c > 0);
  if (dangerHours.length) {
    rows.push(
      statRow(
        'Danger hours',
        dangerHours.map((d) => fmtHour(d.h)).join(', '),
        'highest concentration of negative messages'
      )
    );
  }

  rows.push(
    statRow(
      'Sunday Scaries Index',
      `${stats.timing.sundayScariesIndex}`,
      'avg sentiment Sun 5–11pm (negative = tense)'
    )
  );

  if (stats.ghosting.events) {
    const breakdown = Object.entries(stats.ghosting.byPerson)
      .map(([n, c]) => `${escapeHtml(n)}: ${c}`)
      .join(' · ');
    rows.push(
      statRow(
        'Ghosting events',
        `${stats.ghosting.events}`,
        breakdown ? `silences over 24h — ${breakdown}` : 'silences over 24h'
      )
    );
  }

  if (stats.ghosting.worstExamples?.length) {
    const worst = stats.ghosting.worstExamples[0];
    rows.push(
      statRow(
        'Longest ghost',
        `${worst.gapHours}h`,
        `last message: "${escapeHtml(worst.precededBy.slice(0, 80))}${
          worst.precededBy.length > 80 ? '…' : ''
        }"`
      )
    );
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join(
    ''
  )}</table>`;
}

function funnyStats(stats) {
  const rows = [];
  const senders = Object.keys(stats.perSender);

  // Apologies counter
  const apolSorted = [...senders].sort(
    (a, b) => stats.perSender[b].apologies - stats.perSender[a].apologies
  );
  if (apolSorted.length >= 2) {
    rows.push(
      statRow(
        'Sorry champion 🏆',
        `${escapeHtml(apolSorted[0])} (${stats.perSender[apolSorted[0]].apologies}× vs ${
          stats.perSender[apolSorted[1]].apologies
        }×)`,
        'said sorry the most'
      )
    );
  }

  // Double-text leader
  const dtSorted = [...senders].sort(
    (a, b) => stats.perSender[b].doubleTexts - stats.perSender[a].doubleTexts
  );
  if (dtSorted.length >= 2 && stats.perSender[dtSorted[0]].doubleTexts > 0) {
    rows.push(
      statRow(
        'Double-text king/queen',
        `${escapeHtml(dtSorted[0])} (${stats.perSender[dtSorted[0]].doubleTexts}×)`,
        'sent a follow-up before getting a reply'
      )
    );
  }

  // Response speed delta
  if (stats.speedDelta) {
    rows.push(
      statRow(
        'Reply speed gap',
        `${escapeHtml(stats.speedDelta.faster)} replies ${stats.speedDelta.diffMin}m faster`,
        `vs ${escapeHtml(stats.speedDelta.slower)} (median)`
      )
    );
  }

  // Peak affection hour
  rows.push(
    statRow(
      'Peak affection hour',
      fmtHour(stats.timing.peakAffectionHour),
      'when "I love you" / 🥰 / 💕 land most'
    )
  );

  // Good morning reliability
  for (const name of senders) {
    rows.push(
      statRow(
        `${escapeHtml(name)}'s "good morning" reliability`,
        `${stats.perSender[name].goodMorningReliability}%`,
        `${stats.perSender[name].goodMornings} GMs across ${stats.meta.activeDays} active days`
      )
    );
  }

  // Novelist vs one-liner
  for (const name of senders) {
    const ps = stats.perSender[name];
    const label =
      ps.novelistMsgs > ps.oneLinerMsgs / 4
        ? '📚 Novelist'
        : ps.oneLinerMsgs > ps.novelistMsgs * 6
          ? '🩳 One-liner'
          : '⚖️ Balanced';
    rows.push(
      statRow(
        `${escapeHtml(name)} writes like…`,
        label,
        `${ps.novelistMsgs} novels · ${ps.oneLinerMsgs} one-liners · median ${ps.medianWords} words`
      )
    );
  }

  // Vocabulary crossover
  if (stats.vocabCrossover.length) {
    const top = stats.vocabCrossover.slice(0, 4);
    const html = top
      .map(
        (v) =>
          `<span style="display:inline-block;padding:3px 8px;margin:2px 4px 2px 0;background:#1f1f2c;border:1px solid #2a2a36;border-radius:14px;font-size:12px;color:#e8e8ee;"><b>${escapeHtml(
            v.word
          )}</b> <span style="color:#888;">${escapeHtml(v.from)}→${escapeHtml(v.to)}</span></span>`
      )
      .join('');
    rows.push(
      statRow(
        'Vocab crossover',
        '<span style="color:#888;">see chips →</span>',
        html
      )
    );
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join(
    ''
  )}</table>`;
}

function svgBars(values, labels, opts = {}) {
  const w = opts.width || 600;
  const h = opts.height || 120;
  const pad = { l: 28, r: 8, t: 8, b: 22 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(1, ...values);
  const barW = innerW / values.length;

  const bars = values
    .map((v, i) => {
      const bh = (v / max) * innerH;
      const x = pad.l + i * barW + 2;
      const y = pad.t + (innerH - bh);
      const color = opts.colorFn ? opts.colorFn(v, i) : '#a78bfa';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 4).toFixed(
        1
      )}" height="${bh.toFixed(1)}" fill="${color}" rx="2"></rect>`;
    })
    .join('');

  const labelEls = labels
    .map((l, i) => {
      if (opts.skipLabel && opts.skipLabel(i, labels.length)) return '';
      const x = pad.l + i * barW + barW / 2;
      const y = h - 6;
      return `<text x="${x.toFixed(
        1
      )}" y="${y}" fill="#888" font-size="9" font-family="-apple-system, sans-serif" text-anchor="middle">${escapeHtml(
        l
      )}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="display:block;">
    <rect x="0" y="0" width="${w}" height="${h}" fill="#0d0d14" rx="8"></rect>
    ${bars}
    ${labelEls}
  </svg>`;
}

function svgLine(values, opts = {}) {
  const w = opts.width || 600;
  const h = opts.height || 120;
  const pad = { l: 8, r: 8, t: 12, b: 18 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(1, ...values);
  const stepX = innerW / Math.max(1, values.length - 1);

  const points = values
    .map((v, i) => {
      const x = pad.l + i * stepX;
      const y = pad.t + innerH - (v / max) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPoints = `${pad.l},${pad.t + innerH} ${points} ${pad.l + innerW},${
    pad.t + innerH
  }`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="display:block;">
    <rect x="0" y="0" width="${w}" height="${h}" fill="#0d0d14" rx="8"></rect>
    <defs>
      <linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${areaPoints}" fill="url(#lg1)"></polygon>
    <polyline points="${points}" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
  </svg>`;
}

function buildHourlyChart(hourly) {
  const labels = Array.from({ length: 24 }, (_, i) => {
    if (i % 3 !== 0) return '';
    return fmtHour(i).replace(' ', '');
  });
  return svgBars(hourly, labels, {
    skipLabel: (i) => i % 3 !== 0,
    colorFn: (v, i) => {
      // peak hours get accent
      const max = Math.max(...hourly);
      return v === max ? '#fbbf24' : v > max * 0.6 ? '#a78bfa' : '#4c4866';
    },
  });
}

function buildWeekdayChart(weekday) {
  return svgBars(weekday, DAY_NAMES, {
    height: 120,
    colorFn: (v) => {
      const max = Math.max(...weekday);
      return v === max ? '#34d399' : v > max * 0.6 ? '#a78bfa' : '#4c4866';
    },
  });
}

function buildTimelineChart(messages) {
  // Bucket into ~40 buckets across the timeline
  if (!messages.length) return '';
  const first = messages[0].timestamp.getTime();
  const last = messages[messages.length - 1].timestamp.getTime();
  const span = Math.max(1, last - first);
  const N = 40;
  const buckets = Array(N).fill(0);
  for (const m of messages) {
    const idx = Math.min(N - 1, Math.floor(((m.timestamp.getTime() - first) / span) * N));
    buckets[idx]++;
  }
  return svgLine(buckets, { height: 110 });
}

function aiNarrativeHtml(narrative) {
  if (!narrative) return '<p style="color:#888;">(narrative unavailable)</p>';
  return narrative
    .split(/\n\s*\n/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;">${escapeHtml(p.trim()).replace(
          /\n/g,
          '<br/>'
        )}</p>`
    )
    .join('');
}

export function renderReport({ stats, narrative, oneLiner, messages }) {
  const tpl = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const senders = stats.meta.participants;
  const title = senders.length === 2
    ? `${senders[0]} & ${senders[1]}`
    : senders.length === 1
      ? `${senders[0]} (solo)`
      : `${senders.length} people, one chat`;

  const replacements = {
    TITLE: escapeHtml(title),
    ONE_LINER: escapeHtml(oneLiner || 'A duo with patterns, and now you can see them.'),
    TOTAL_MESSAGES: stats.meta.totalMessages.toLocaleString(),
    DAYS_SPAN: stats.meta.daysSpan.toLocaleString(),
    MSGS_PER_DAY: stats.meta.messagesPerDay,
    TOTAL_WORDS: stats.meta.totalWords.toLocaleString(),
    LANGUAGE_NOTE: (() => {
      const lang = stats.meta.detectedLanguage;
      if (!lang) return '';
      if (!lang.keywordSupport) {
        return `chat language: ${escapeHtml(lang.name)} · keyword stats limited; structural stats unaffected · narrative written in English`;
      }
      return `chat language: ${escapeHtml(lang.name)} · narrative written in English`;
    })(),
    PARTICIPANT_CARDS: participantCards(stats.perSender),
    GREEN_ZONE_BODY: greenZone(stats),
    RED_ZONE_BODY: redZone(stats),
    FUNNY_STATS_BODY: funnyStats(stats),
    HOURLY_CHART: buildHourlyChart(stats.timing.hourly),
    WEEKDAY_CHART: buildWeekdayChart(stats.timing.weekday),
    TIMELINE_CHART: buildTimelineChart(messages),
    AI_NARRATIVE: aiNarrativeHtml(narrative),
    GENERATED_AT: new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
  };

  let html = tpl;
  for (const [k, v] of Object.entries(replacements)) {
    html = html.split(`{{${k}}}`).join(v);
  }
  return html;
}
