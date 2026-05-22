import fs from 'fs';
import path from 'path';

// WhatsApp exports look roughly like one of these per message:
//   12/31/23, 11:59 PM - Alice: Happy new year!
//   31/12/2023, 23:59 - Alice: Happy new year!
//   [12/31/23, 11:59:07 PM] Alice: Happy new year!
//   31.12.23, 23:59 - Alice: Happy new year!
// followed by zero or more continuation lines that belong to the same message.
//
// We detect a "new message" line via a leading-timestamp regex; anything that
// doesn't match is appended to the previous message's body.

const MESSAGE_START = new RegExp(
  // optional opening bracket, then a date like 1/2/23 or 01.02.2023 or 2023-01-02
  '^\\[?\\s*' +
    '(\\d{1,4}[\\/\\.\\-]\\d{1,2}[\\/\\.\\-]\\d{1,4})' +
    ',?\\s+' +
    // time HH:MM(:SS)? optional am/pm
    '(\\d{1,2}:\\d{2}(?::\\d{2})?)\\s*' +
    '([AaPp]\\.?[Mm]\\.?)?' +
    '\\]?' +
    // separator: " - " or "] " between header and body
    '\\s*[-–]?\\s*' +
    '(.*)$'
);

const SYSTEM_HINTS = [
  'Messages and calls are end-to-end encrypted',
  'created group',
  'added you',
  'changed the subject',
  'changed this group',
  'changed the group',
  'left',
  'removed',
  'You deleted this message',
  'This message was deleted',
  'Missed voice call',
  'Missed video call',
  'security code changed',
];

function parseTimestamp(dateStr, timeStr, ampm, dayFirst = null) {
  // Normalize separators
  const dateParts = dateStr.split(/[\/\.\-]/).map((p) => p.trim());
  let day, month, year;

  if (dateParts[0].length === 4) {
    // YYYY-MM-DD
    [year, month, day] = dateParts.map(Number);
  } else {
    // Could be MM/DD/YY or DD/MM/YY. WhatsApp is locale-dependent.
    const a = Number(dateParts[0]);
    const b = Number(dateParts[1]);
    year = Number(dateParts[2]);
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      month = a;
      day = b;
    } else {
      // Ambiguous — use the file-level dayFirst hint if available.
      // If unknown, default to month-first (US-style, which is what WhatsApp's
      // most common english export uses).
      if (dayFirst === true) {
        day = a;
        month = b;
      } else {
        month = a;
        day = b;
      }
    }
    if (year < 100) year += 2000;
  }

  const [hStr, mStr, sStr] = timeStr.split(':');
  let hour = Number(hStr);
  const minute = Number(mStr);
  const second = sStr ? Number(sStr) : 0;

  if (ampm) {
    const isPm = /p/i.test(ampm);
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }

  return new Date(year, month - 1, day, hour, minute, second);
}

function isSystemMessage(body) {
  return SYSTEM_HINTS.some((hint) => body.includes(hint));
}

function detectDayFirst(lines) {
  // Returns true if day-first detected, false if month-first detected, null if ambiguous.
  let dayFirstVotes = 0;
  let monthFirstVotes = 0;
  for (const line of lines) {
    const m = line.match(MESSAGE_START);
    if (!m) continue;
    const dateStr = m[1];
    const parts = dateStr.split(/[\/\.\-]/).map((p) => p.trim());
    if (parts[0].length === 4) continue; // YYYY-first, not relevant
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a > 12 && b <= 12) dayFirstVotes++;
    else if (b > 12 && a <= 12) monthFirstVotes++;
  }
  if (dayFirstVotes > monthFirstVotes) return true;
  if (monthFirstVotes > dayFirstVotes) return false;
  return null;
}

export function parseChatFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/‎|‏/g, '');
  const lines = raw.split(/\r?\n/);
  const dayFirst = detectDayFirst(lines);
  const messages = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(MESSAGE_START);
    if (m) {
      if (current) messages.push(current);
      const [, dateStr, timeStr, ampm, rest] = m;
      let timestamp;
      try {
        timestamp = parseTimestamp(dateStr, timeStr, ampm, dayFirst);
      } catch {
        timestamp = null;
      }

      // body looks like "Alice: hello there" — split on the first colon.
      const colonIdx = rest.indexOf(':');
      let sender = null;
      let body = rest;
      if (colonIdx > 0 && colonIdx < 80) {
        sender = rest.slice(0, colonIdx).trim();
        body = rest.slice(colonIdx + 1).trim();
      }

      if (!sender || isSystemMessage(rest)) {
        // System message — keep timestamp metadata but ignore for stats.
        current = null;
        continue;
      }

      current = {
        timestamp,
        sender,
        text: body,
        file: path.basename(filePath),
      };
    } else if (current && line.trim().length > 0) {
      current.text += '\n' + line;
    }
  }
  if (current) messages.push(current);

  return messages.filter((msg) => msg.timestamp && msg.sender && msg.text);
}

export function parseChatFiles(filePaths) {
  const all = [];
  const perFile = {};
  for (const fp of filePaths) {
    const msgs = parseChatFile(fp);
    perFile[path.basename(fp)] = msgs.length;
    all.push(...msgs);
  }
  all.sort((a, b) => a.timestamp - b.timestamp);
  return { messages: all, perFile };
}
