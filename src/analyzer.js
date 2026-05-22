// All deterministic stat computations. No network calls here.
// The output of `analyze()` is the single source of truth that feeds both
// the Claude narrative and the HTML template.

import { detectLanguage, getLanguagePack, languageName } from './lang.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The "?" token is universal; the question-word list is only useful for
// English. Other languages still get the "?" punctuation match.
const QUESTION_TOKENS = [
  /\?/, /¿/, /\bwhat\b/i, /\bwhy\b/i, /\bwhen\b/i, /\bwhere\b/i, /\bhow\b/i,
];

const EMOJI_REGEX =
  /\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*|[\u{1F1E6}-\u{1F1FF}]{2}/gu;

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function countMatches(text, patterns) {
  return patterns.reduce((n, p) => (p.test(text) ? n + 1 : n), 0);
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pct(n, total) {
  if (!total) return 0;
  return Math.round((n / total) * 1000) / 10;
}

function topN(map, n = 3) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ key: k, value: v }));
}

function sentimentScore(text, pack) {
  if (pack.minimal) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of pack.positive) if (lower.includes(w)) score += 1;
  for (const w of pack.negative) if (lower.includes(w)) score -= 1;
  return score;
}

function classifyTopics(text, pack) {
  if (pack.minimal) return [];
  const lower = text.toLowerCase();
  const hits = [];
  for (const [topic, words] of Object.entries(pack.topics)) {
    if (words.some((w) => lower.includes(w.toLowerCase()))) hits.push(topic);
  }
  return hits;
}

function affectionMatchCount(text, pack) {
  let n = 0;
  if (pack.affectionEmoji && pack.affectionEmoji.test(text)) n++;
  for (const re of pack.affectionText) if (re.test(text)) n++;
  return n;
}

function buildPerSenderEmpty() {
  return {
    count: 0,
    words: 0,
    chars: 0,
    questions: 0,
    apologies: 0,
    goodMornings: 0,
    goodNights: 0,
    affection: 0,
    doubleTexts: 0,
    initiations: 0,
    emojis: {},
    msgLengths: [],
    responseTimesMin: [],
    vocab: {},
    sentiment: 0,
  };
}

export function analyze(messages) {
  if (!messages.length) {
    throw new Error('No messages found in the supplied chat files.');
  }

  const detected = detectLanguage(messages);
  const pack = getLanguagePack(detected.code);

  const senders = [...new Set(messages.map((m) => m.sender))];
  const perSender = Object.fromEntries(senders.map((s) => [s, buildPerSenderEmpty()]));

  const hourly = Array(24).fill(0);
  const weekday = Array(7).fill(0);
  const dayHourPositive = {}; // "weekday-hour" -> sentiment sum
  const dayHourCount = {};
  const perDayCount = {};
  const perDaySentiment = {};
  const topicCounts = {};
  const topicSentiment = {};
  const topicResponseDelay = {}; // topic -> [delay minutes from prev msg]
  const dangerHours = Array(24).fill(0); // negative-sentiment messages by hour

  let prev = null;
  let totalChars = 0;
  let totalWords = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const sender = msg.sender;
    const text = msg.text;
    const dt = msg.timestamp;
    const hour = dt.getHours();
    const wday = dt.getDay();
    const dateKey = dt.toISOString().slice(0, 10);
    const dhKey = `${wday}-${hour}`;

    const tokens = tokenize(text);
    const wordCount = tokens.length;
    totalChars += text.length;
    totalWords += wordCount;

    const ps = perSender[sender];
    ps.count++;
    ps.words += wordCount;
    ps.chars += text.length;
    ps.msgLengths.push(wordCount);
    ps.questions += countMatches(text, QUESTION_TOKENS);
    ps.apologies += countMatches(text, pack.apology);
    ps.goodMornings += countMatches(text, pack.goodMorning);
    ps.goodNights += countMatches(text, pack.goodNight);
    ps.affection += affectionMatchCount(text, pack);

    const sent = sentimentScore(text, pack);
    ps.sentiment += sent;

    const emojis = text.match(EMOJI_REGEX) || [];
    for (const e of emojis) ps.emojis[e] = (ps.emojis[e] || 0) + 1;

    for (const tk of tokens) {
      if (tk.length >= 4) ps.vocab[tk] = (ps.vocab[tk] || 0) + 1;
    }

    hourly[hour]++;
    weekday[wday]++;
    perDayCount[dateKey] = (perDayCount[dateKey] || 0) + 1;
    perDaySentiment[dateKey] = (perDaySentiment[dateKey] || 0) + sent;
    dayHourPositive[dhKey] = (dayHourPositive[dhKey] || 0) + sent;
    dayHourCount[dhKey] = (dayHourCount[dhKey] || 0) + 1;
    if (sent < 0) dangerHours[hour]++;

    const topics = classifyTopics(text, pack);
    for (const t of topics) {
      topicCounts[t] = (topicCounts[t] || 0) + 1;
      topicSentiment[t] = (topicSentiment[t] || 0) + sent;
    }

    // Reply / initiation tracking
    if (prev) {
      const gapMin = (dt - prev.timestamp) / 60000;
      const gapHours = gapMin / 60;
      if (prev.sender !== sender && gapMin >= 0) {
        // sender is replying to prev.sender
        ps.responseTimesMin.push(gapMin);
        for (const t of topics) {
          if (!topicResponseDelay[t]) topicResponseDelay[t] = [];
          topicResponseDelay[t].push(gapMin);
        }
      } else if (prev.sender === sender && gapMin > 5) {
        ps.doubleTexts++;
      }
      // Initiation = message after a 6h+ silence
      if (gapHours >= 6) ps.initiations++;
    } else {
      ps.initiations++;
    }
    prev = msg;
  }

  // Conversation streaks: consecutive days with at least one message
  const sortedDays = Object.keys(perDayCount).sort();
  let longestStreak = 0;
  let currentStreak = 0;
  let streakStart = null;
  let bestStreakStart = null;
  let bestStreakEnd = null;
  let prevDay = null;
  for (const d of sortedDays) {
    if (!prevDay) {
      currentStreak = 1;
      streakStart = d;
    } else {
      const diffDays = (new Date(d) - new Date(prevDay)) / (1000 * 60 * 60 * 24);
      if (diffDays === 1) {
        currentStreak++;
      } else {
        currentStreak = 1;
        streakStart = d;
      }
    }
    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
      bestStreakStart = streakStart;
      bestStreakEnd = d;
    }
    prevDay = d;
  }

  // Longest positive streak: consecutive days with positive sentiment sum
  let longestPositiveStreak = 0;
  let posStreak = 0;
  let posStreakStart = null;
  let bestPosStart = null;
  let bestPosEnd = null;
  prevDay = null;
  for (const d of sortedDays) {
    const isPositive = (perDaySentiment[d] || 0) > 0;
    const continuous = prevDay && (new Date(d) - new Date(prevDay)) / 86400000 === 1;
    if (isPositive && (continuous || posStreak === 0)) {
      if (posStreak === 0) posStreakStart = d;
      posStreak++;
    } else {
      posStreak = isPositive ? 1 : 0;
      if (isPositive) posStreakStart = d;
    }
    if (posStreak > longestPositiveStreak) {
      longestPositiveStreak = posStreak;
      bestPosStart = posStreakStart;
      bestPosEnd = d;
    }
    prevDay = d;
  }

  // Best day/time slots: highest avg sentiment among slots with enough volume
  const slotScores = Object.keys(dayHourCount)
    .filter((k) => dayHourCount[k] >= 3)
    .map((k) => ({
      key: k,
      avg: dayHourPositive[k] / dayHourCount[k],
      count: dayHourCount[k],
    }))
    .sort((a, b) => b.avg - a.avg);

  const bestSlots = slotScores.slice(0, 3).map((s) => {
    const [w, h] = s.key.split('-').map(Number);
    return { day: DAY_NAMES[w], hour: h, score: Math.round(s.avg * 100) / 100, sample: s.count };
  });

  // Sunday Scaries: average sentiment on Sunday evening (5pm-11pm)
  const scarySlots = ['0-17', '0-18', '0-19', '0-20', '0-21', '0-22', '0-23'];
  let scarySent = 0;
  let scaryCount = 0;
  for (const k of scarySlots) {
    if (dayHourCount[k]) {
      scarySent += dayHourPositive[k];
      scaryCount += dayHourCount[k];
    }
  }
  const sundayScariesIndex = scaryCount
    ? Math.round((scarySent / scaryCount) * 100) / 100
    : 0;

  // Ghosting events: gaps >= 24h, attribute to whoever messaged last before silence
  const ghostingEvents = [];
  for (let i = 1; i < messages.length; i++) {
    const gapHours = (messages[i].timestamp - messages[i - 1].timestamp) / 3600000;
    if (gapHours >= 24) {
      const lastBefore = messages[i - 1];
      ghostingEvents.push({
        ghoster: messages[i].sender === lastBefore.sender ? lastBefore.sender : messages[i].sender === lastBefore.sender,
        // Whoever did NOT respond — i.e., the *other* person from the last sender
        silentParty: messages[i].sender, // the one who broke the silence
        lastSender: lastBefore.sender,
        gapHours: Math.round(gapHours * 10) / 10,
        precededBy: lastBefore.text.slice(0, 200),
        date: lastBefore.timestamp.toISOString().slice(0, 10),
      });
    }
  }
  // Ghosting attribution: the silent party is the one who *received* the last message
  // and didn't reply. That's senders \ lastSender (only meaningful for 2-person chats).
  const ghostingByPerson = {};
  for (const ev of ghostingEvents) {
    const others = senders.filter((s) => s !== ev.lastSender);
    if (others.length === 1) {
      const ghoster = others[0];
      ghostingByPerson[ghoster] = (ghostingByPerson[ghoster] || 0) + 1;
      ev.ghoster = ghoster;
    }
  }

  // Vocabulary crossover: phrases / words one person picked up from the other.
  // Heuristic: word used >=3 times by person A *before* person B ever used it,
  // then later used by person B at least twice.
  const vocabCrossover = [];
  if (senders.length === 2) {
    const [a, b] = senders;
    const firstUseBy = {}; // word -> sender
    const useCountAfter = {}; // word -> { sender: count }
    for (const msg of messages) {
      for (const tk of tokenize(msg.text)) {
        if (tk.length < 4 || tk.length > 18) continue;
        if (!firstUseBy[tk]) {
          firstUseBy[tk] = msg.sender;
          useCountAfter[tk] = { [a]: 0, [b]: 0 };
        }
        useCountAfter[tk][msg.sender]++;
      }
    }
    const candidates = [];
    for (const [word, originator] of Object.entries(firstUseBy)) {
      const other = originator === a ? b : a;
      if (useCountAfter[word][originator] >= 3 && useCountAfter[word][other] >= 2) {
        candidates.push({
          word,
          from: originator,
          to: other,
          spread: useCountAfter[word][other],
        });
      }
    }
    candidates.sort((x, y) => y.spread - x.spread);
    vocabCrossover.push(...candidates.slice(0, 8));
  }

  // Cold-reply topics: which topics correlate with longest reply delays + lowest sentiment
  const topicAnalysis = Object.keys(topicCounts)
    .map((t) => ({
      topic: t,
      mentions: topicCounts[t],
      avgSentiment: Math.round((topicSentiment[t] / topicCounts[t]) * 100) / 100,
      medianReplyMin: Math.round(median(topicResponseDelay[t] || [])),
    }))
    .sort((a, b) => b.mentions - a.mentions);

  const greenTopics = [...topicAnalysis]
    .sort((a, b) => b.avgSentiment - a.avgSentiment)
    .slice(0, 3);
  const redTopics = [...topicAnalysis]
    .sort((a, b) => (a.avgSentiment - b.avgSentiment) || (b.medianReplyMin - a.medianReplyMin))
    .slice(0, 3);

  // Per-sender finalization
  const perSenderFinal = {};
  for (const [name, ps] of Object.entries(perSender)) {
    perSenderFinal[name] = {
      messages: ps.count,
      sharePct: pct(ps.count, messages.length),
      words: ps.words,
      avgWords: ps.count ? Math.round((ps.words / ps.count) * 10) / 10 : 0,
      medianWords: median(ps.msgLengths),
      questions: ps.questions,
      apologies: ps.apologies,
      goodMornings: ps.goodMornings,
      goodNights: ps.goodNights,
      affection: ps.affection,
      doubleTexts: ps.doubleTexts,
      initiations: ps.initiations,
      sentiment: ps.sentiment,
      topEmojis: topN(ps.emojis, 5),
      medianReplyMin: Math.round(median(ps.responseTimesMin)),
      avgReplyMin: ps.responseTimesMin.length
        ? Math.round(ps.responseTimesMin.reduce((a, b) => a + b, 0) / ps.responseTimesMin.length)
        : 0,
      ghosted: ghostingByPerson[name] || 0,
      // Length distribution: novelist (>40 words) vs one-liner (<=5 words)
      novelistMsgs: ps.msgLengths.filter((n) => n > 40).length,
      oneLinerMsgs: ps.msgLengths.filter((n) => n <= 5).length,
    };
  }

  // Good Morning reliability: % of days with a "good morning" out of active days
  const activeDays = sortedDays.length;
  for (const name of senders) {
    perSenderFinal[name].goodMorningReliability = activeDays
      ? Math.round((perSenderFinal[name].goodMornings / activeDays) * 1000) / 10
      : 0;
  }

  // Peak affection hour
  const affectionByHour = Array(24).fill(0);
  for (const msg of messages) {
    if (affectionMatchCount(msg.text, pack) > 0) affectionByHour[msg.timestamp.getHours()]++;
  }
  const peakAffectionHour = affectionByHour.indexOf(Math.max(...affectionByHour));

  // Response speed delta (positive = first sender replies faster than second)
  let speedDelta = null;
  if (senders.length === 2) {
    const [a, b] = senders;
    const aMed = perSenderFinal[a].medianReplyMin;
    const bMed = perSenderFinal[b].medianReplyMin;
    speedDelta = {
      faster: aMed < bMed ? a : b,
      slower: aMed < bMed ? b : a,
      diffMin: Math.abs(aMed - bMed),
    };
  }

  // Date range
  const firstMsg = messages[0].timestamp;
  const lastMsg = messages[messages.length - 1].timestamp;
  const daysSpan = Math.max(
    1,
    Math.round((lastMsg - firstMsg) / 86400000) + 1
  );

  return {
    meta: {
      totalMessages: messages.length,
      totalWords,
      totalChars,
      participants: senders,
      firstMessage: firstMsg.toISOString(),
      lastMessage: lastMsg.toISOString(),
      daysSpan,
      activeDays,
      messagesPerDay: Math.round((messages.length / daysSpan) * 10) / 10,
      detectedLanguage: {
        code: detected.code,
        name: languageName(detected.code),
        confidence: Math.round(detected.confidence * 100) / 100,
        source: detected.source,
        keywordSupport: !pack.minimal,
      },
    },
    perSender: perSenderFinal,
    timing: {
      hourly,
      weekday,
      bestSlots,
      dangerHours,
      sundayScariesIndex,
      peakAffectionHour,
    },
    streaks: {
      longestActiveStreak: longestStreak,
      longestActiveStreakStart: bestStreakStart,
      longestActiveStreakEnd: bestStreakEnd,
      longestPositiveStreak,
      longestPositiveStreakStart: bestPosStart,
      longestPositiveStreakEnd: bestPosEnd,
    },
    topics: {
      green: greenTopics,
      red: redTopics,
      all: topicAnalysis,
    },
    ghosting: {
      events: ghostingEvents.length,
      byPerson: ghostingByPerson,
      worstExamples: ghostingEvents
        .sort((a, b) => b.gapHours - a.gapHours)
        .slice(0, 3)
        .map((e) => ({
          ghoster: e.ghoster || 'unknown',
          gapHours: e.gapHours,
          precededBy: e.precededBy,
          date: e.date,
        })),
    },
    vocabCrossover,
    speedDelta,
  };
}
