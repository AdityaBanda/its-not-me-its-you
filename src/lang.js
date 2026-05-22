// Language detection + multilingual keyword packs.
//
// Detection happens once per chat dataset:
//   1. Try unicode-script signals (Devanagari, Arabic, CJK, Hangul, Cyrillic,
//      Hiragana/Katakana, Hebrew, Thai). These are deterministic.
//   2. Otherwise score against Latin-script stopword tables.
//   3. If still unclear, fall back to "minimal" mode — emoji-only affection,
//      no keyword sentiment / topics / apology counters.
//
// We export a single getLanguagePack(code) that the analyzer queries instead
// of holding hardcoded lists.

const SCRIPT_RANGES = [
  { code: 'hi', name: 'Hindi (Devanagari)', re: /[ऀ-ॿ]/ },
  { code: 'ar', name: 'Arabic', re: /[؀-ۿ]/ },
  { code: 'he', name: 'Hebrew', re: /[֐-׿]/ },
  { code: 'ru', name: 'Russian (Cyrillic)', re: /[Ѐ-ӿ]/ },
  { code: 'ko', name: 'Korean (Hangul)', re: /[가-힯ᄀ-ᇿ㄰-㆏]/ },
  { code: 'ja', name: 'Japanese (Hiragana/Katakana)', re: /[぀-ゟ゠-ヿ]/ },
  { code: 'zh', name: 'Chinese (Han)', re: /[一-鿿]/ },
  { code: 'th', name: 'Thai', re: /[฀-๿]/ },
];

// Stopword tables for Latin-script languages. Higher hit count = more likely.
// Hindi gets the romanized "Hinglish" tokens here — pure-Latin Hinglish messages
// won't trigger the script detector but are very common in WhatsApp.
const LATIN_STOPWORDS = {
  en: ['the', 'and', 'you', 'that', 'have', 'with', 'this', 'just', 'what', 'about', 'thanks', 'please'],
  es: ['que', 'pero', 'porque', 'también', 'cuando', 'estoy', 'estás', 'gracias', 'mañana', 'noche', 'amor', 'bueno', 'hola'],
  pt: ['que', 'não', 'estou', 'você', 'também', 'mas', 'porque', 'quando', 'obrigado', 'obrigada', 'amor', 'bom', 'oi'],
  fr: ['que', 'pas', 'avec', 'mais', 'parce', 'quand', 'aussi', 'merci', 'bonjour', 'amour', 'bien', 'demain'],
  de: ['ich', 'nicht', 'auch', 'aber', 'weil', 'wann', 'danke', 'guten', 'morgen', 'abend', 'liebe'],
  it: ['che', 'non', 'sono', 'anche', 'perché', 'quando', 'grazie', 'buongiorno', 'amore', 'buona', 'ciao'],
  nl: ['niet', 'maar', 'ook', 'omdat', 'wanneer', 'dank', 'liefde', 'hallo'],
  tr: ['için', 'değil', 'çok', 'ama', 'çünkü', 'günaydın', 'teşekkür', 'seni', 'merhaba'],
  id: ['tidak', 'juga', 'tapi', 'karena', 'kapan', 'terima kasih', 'pagi', 'malam', 'cinta', 'halo'],
  hi: [
    'kya', 'hai', 'haan', 'nahi', 'nahin', 'mein', 'theek', 'accha', 'achha',
    'sahi', 'bahut', 'kal', 'aaj', 'pyaar', 'pyar', 'jaan', 'jaanu', 'tum',
    'tumhe', 'tumhara', 'tumhari', 'mera', 'meri', 'mujhe', 'main', 'maine',
    'kaisa', 'kaisi', 'matlab', 'phir', 'wala', 'wali', 'maafi', 'maaf',
    'shukriya', 'pareshan', 'thoda', 'kuch', 'kahan', 'kab', 'kyun', 'kyon',
  ],
};

function detectByScript(samples) {
  // Returns the script-language with the highest density of script-matching characters.
  // Threshold is intentionally low (3%) because mixed-script chats — like Hinglish
  // with occasional Devanagari, or French with mostly Latin + a few accented words —
  // should still skew toward the non-Latin language. CJK/Arabic/Cyrillic/etc. are
  // never mixed casually with Latin script in chat, so a small density is a strong
  // signal.
  const counts = {};
  let total = 0;
  for (const s of samples) {
    for (const ch of s) {
      total++;
      for (const sr of SCRIPT_RANGES) {
        if (sr.re.test(ch)) counts[sr.code] = (counts[sr.code] || 0) + 1;
      }
    }
  }
  if (!total) return null;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const ratio = top[1] / total;
  if (ratio < 0.03) return null;
  return { code: top[0], confidence: Math.min(1, ratio * 4) };
}

function detectByStopwords(samples) {
  const text = samples.join(' ').toLowerCase();
  const scores = {};
  for (const [code, words] of Object.entries(LATIN_STOPWORDS)) {
    let s = 0;
    for (const w of words) {
      const re = new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`, 'gi');
      const matches = text.match(re);
      if (matches) s += matches.length;
    }
    scores[code] = s;
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!sorted.length || sorted[0][1] === 0) return null;
  const [topCode, topScore] = sorted[0];
  const runnerUp = sorted[1] ? sorted[1][1] : 0;
  // Need a meaningful margin to call it confidently.
  const confidence = topScore > 0 ? Math.min(1, (topScore - runnerUp) / Math.max(topScore, 1)) : 0;
  return { code: topCode, confidence };
}

export function detectLanguage(messages) {
  // Sample up to ~200 messages, max ~50KB of text, to keep detection fast.
  const sample = [];
  let bytes = 0;
  for (const m of messages) {
    sample.push(m.text);
    bytes += m.text.length;
    if (sample.length >= 200 || bytes >= 50_000) break;
  }

  const scriptHit = detectByScript(sample);
  if (scriptHit) return { ...scriptHit, source: 'script' };

  const stopHit = detectByStopwords(sample);
  if (stopHit && stopHit.confidence >= 0.2) return { ...stopHit, source: 'stopwords' };

  return { code: 'unknown', confidence: 0, source: 'fallback' };
}

// ============================================================
// Keyword packs
// ============================================================
// Each pack defines:
//   positive: array of lowercase strings/regexes for positive sentiment
//   negative: array for negative sentiment
//   apology: array of regexes
//   goodMorning: array of regexes
//   goodNight: array of regexes
//   affection: array of regexes (text only — emojis added universally)
//   topics: { topicEnglishLabel: [keyword strings] }

// Emojis count as affection in every language.
const UNIVERSAL_AFFECTION_EMOJI =
  /❤️|🥰|😘|💕|💖|💗|💘|💞|💝|🤍|🖤|❤|♥|💋|😍/u;

const PACKS = {
  en: {
    positive: ['love', 'haha', 'lol', 'lmao', 'great', 'awesome', 'happy', 'thanks', 'thank you', 'cute', 'sweet', 'miss you', 'amazing', 'perfect', 'yay', 'best', 'beautiful', 'good', 'nice', 'glad', 'proud'],
    negative: ['angry', 'sad', 'upset', 'annoyed', 'tired', 'hate', 'sorry', 'wtf', 'mad', 'fight', 'whatever', 'nvm', 'frustrated', 'hurt', 'cry'],
    apology: [/\bsorry\b/i, /\bmy bad\b/i, /\bmy fault\b/i, /\bapolog/i],
    goodMorning: [/\b(good\s*morning|gmornin\w*|gm)\b/i],
    goodNight: [/\b(good\s*night|gnight|gn)\b/i],
    affection: [/\bi love you\b/i, /\bily\b/i, /\blove u\b/i, /\bmiss you\b/i, /\bmiss u\b/i],
    topics: {
      work: ['work', 'job', 'meeting', 'boss', 'office', 'deadline', 'project'],
      family: ['mom', 'dad', 'mum', 'family', 'sister', 'brother', 'parents'],
      food: ['food', 'eat', 'lunch', 'dinner', 'breakfast', 'hungry', 'pizza', 'coffee'],
      plans: ['tonight', 'tomorrow', 'weekend', 'plan', 'meet', 'come over', 'date'],
      feelings: ['feel', 'feeling', 'tired', 'happy', 'sad', 'stressed', 'anxious'],
      money: ['money', 'pay', 'bill', 'split', 'owe', 'rent', 'venmo'],
      relationship: ['us', 'we', 'together', 'future', 'serious', 'commit'],
    },
  },

  es: {
    positive: ['amor', 'jaja', 'jeje', 'genial', 'gracias', 'lindo', 'linda', 'precioso', 'feliz', 'hermoso', 'increíble', 'perfecto', 'bueno', 'bien', 'bonita', 'guapo'],
    negative: ['triste', 'enojado', 'enojada', 'cansado', 'cansada', 'odio', 'lo siento', 'perdón', 'molesta', 'molesto', 'pelea', 'estúpido'],
    apology: [/\b(lo\s*siento|perd[oó]n|perdona|perdoname|disculp\w*|mi\s*culpa)\b/i],
    goodMorning: [/\b(buen[oa]s?\s*d[ií]as?|bd)\b/i],
    goodNight: [/\b(buen[oa]s?\s*noches|bn)\b/i],
    affection: [/\bte (amo|quiero|extra[ñn]o)\b/i, /\bmi (amor|vida|cielo)\b/i, /\btqm\b/i, /\btkm\b/i],
    topics: {
      work: ['trabajo', 'jefe', 'oficina', 'reunión', 'proyecto'],
      family: ['mamá', 'papá', 'familia', 'hermana', 'hermano', 'padres'],
      food: ['comer', 'comida', 'desayuno', 'almuerzo', 'cena', 'café', 'hambre'],
      plans: ['esta noche', 'mañana', 'finde', 'fin de semana', 'planes', 'cita'],
      feelings: ['siento', 'cansad', 'feliz', 'triste', 'estresad', 'ansios'],
      money: ['dinero', 'pagar', 'cuenta', 'renta', 'alquiler'],
      relationship: ['nosotros', 'juntos', 'futuro', 'serio', 'relación'],
    },
  },

  pt: {
    positive: ['amor', 'kkk', 'kkkk', 'haha', 'ótimo', 'obrigado', 'obrigada', 'lindo', 'linda', 'feliz', 'incrível', 'perfeito', 'bom', 'bem', 'fofo'],
    negative: ['triste', 'bravo', 'brava', 'cansado', 'cansada', 'odio', 'desculpa', 'chateado', 'chateada', 'briga'],
    apology: [/\b(desculp\w*|perdão|foi\s*mal|minha\s*culpa)\b/i],
    goodMorning: [/\b(bom\s*dia|bd)\b/i],
    goodNight: [/\b(boa\s*noite|bn)\b/i],
    affection: [/\b(te amo|te adoro|saudade)\b/i, /\bmeu (amor|bem)\b/i],
    topics: {
      work: ['trabalho', 'chefe', 'reunião', 'projeto', 'escritório'],
      family: ['mãe', 'pai', 'família', 'irmã', 'irmão'],
      food: ['comer', 'comida', 'almoço', 'jantar', 'café', 'fome'],
      plans: ['hoje à noite', 'amanhã', 'fim de semana', 'plano', 'encontro'],
      feelings: ['sentindo', 'cansad', 'feliz', 'triste', 'ansios'],
      money: ['dinheiro', 'pagar', 'conta', 'aluguel'],
      relationship: ['nós', 'juntos', 'futuro', 'sério', 'relação'],
    },
  },

  fr: {
    positive: ['amour', 'haha', 'mdr', 'super', 'merci', 'mignon', 'mignonne', 'heureux', 'heureuse', 'magnifique', 'génial', 'parfait', 'bien'],
    negative: ['triste', 'fâché', 'fâchée', 'fatigué', 'fatiguée', 'déteste', 'pardon', 'désolé', 'désolée', 'dispute'],
    apology: [/\b(désolé\w*|pardon|ma\s*faute|je\s*m'excuse)\b/i],
    goodMorning: [/\b(bonjour|bon\s*matin)\b/i],
    goodNight: [/\b(bonne\s*nuit|bn)\b/i],
    affection: [/\bje t'aime\b/i, /\btu me manques\b/i, /\bmon (amour|cœur|coeur|chéri)\b/i, /\bma (chérie|puce)\b/i],
    topics: {
      work: ['travail', 'boulot', 'patron', 'bureau', 'réunion', 'projet'],
      family: ['maman', 'papa', 'famille', 'sœur', 'frère'],
      food: ['manger', 'repas', 'déjeuner', 'dîner', 'café', 'faim'],
      plans: ['ce soir', 'demain', 'week-end', 'plan', 'rendez-vous'],
      feelings: ['fatigué', 'heureux', 'triste', 'stressé', 'anxieux'],
      money: ['argent', 'payer', 'facture', 'loyer'],
      relationship: ['nous', 'ensemble', 'avenir', 'sérieux', 'relation'],
    },
  },

  de: {
    positive: ['liebe', 'haha', 'lol', 'super', 'danke', 'süß', 'glücklich', 'wunderbar', 'perfekt', 'gut', 'schön'],
    negative: ['traurig', 'wütend', 'müde', 'hasse', 'tut mir leid', 'streit', 'verärgert'],
    apology: [/\b(tut\s*mir\s*leid|entschuldig\w*|mein\s*fehler|sorry)\b/i],
    goodMorning: [/\b(guten\s*morgen|morgen)\b/i],
    goodNight: [/\b(gute\s*nacht|gn8)\b/i],
    affection: [/\bich liebe dich\b/i, /\bich vermisse dich\b/i, /\bmein (schatz|liebling)\b/i],
    topics: {
      work: ['arbeit', 'job', 'chef', 'büro', 'meeting', 'projekt'],
      family: ['mama', 'papa', 'familie', 'schwester', 'bruder', 'eltern'],
      food: ['essen', 'frühstück', 'mittag', 'abendessen', 'kaffee', 'hunger'],
      plans: ['heute abend', 'morgen', 'wochenende', 'plan', 'termin'],
      feelings: ['fühle', 'müde', 'glücklich', 'traurig', 'gestresst'],
      money: ['geld', 'zahlen', 'rechnung', 'miete'],
      relationship: ['wir', 'zusammen', 'zukunft', 'ernst', 'beziehung'],
    },
  },

  it: {
    positive: ['amore', 'aha', 'lol', 'grande', 'grazie', 'carino', 'felice', 'bellissimo', 'perfetto', 'bene', 'bello'],
    negative: ['triste', 'arrabbiato', 'stanco', 'odio', 'scusa', 'litigio'],
    apology: [/\b(scus\w*|perdonami|mi\s*dispiace|colpa\s*mia)\b/i],
    goodMorning: [/\b(buongiorno|buon\s*mattino)\b/i],
    goodNight: [/\b(buonanotte|buona\s*notte)\b/i],
    affection: [/\bti amo\b/i, /\bmi manchi\b/i, /\bamore mio\b/i],
    topics: {
      work: ['lavoro', 'capo', 'ufficio', 'riunione', 'progetto'],
      family: ['mamma', 'papà', 'famiglia', 'sorella', 'fratello'],
      food: ['mangiare', 'pranzo', 'cena', 'colazione', 'caffè', 'fame'],
      plans: ['stasera', 'domani', 'weekend', 'piano', 'appuntamento'],
      feelings: ['stanco', 'felice', 'triste', 'stressato', 'ansioso'],
      money: ['soldi', 'pagare', 'conto', 'affitto'],
      relationship: ['noi', 'insieme', 'futuro', 'serio', 'relazione'],
    },
  },

  hi: {
    // Hindi — Devanagari + romanized "Hinglish" both common in WhatsApp
    positive: ['प्यार', 'खुश', 'अच्छा', 'धन्यवाद', 'बहुत अच्छा', 'सुंदर', 'pyaar', 'pyar', 'khush', 'accha', 'shukriya', 'mast', 'zabardast', 'badhiya'],
    negative: ['दुखी', 'गुस्सा', 'थका', 'माफ', 'sorry', 'gussa', 'thak', 'pareshan', 'maafi', 'dukhi'],
    apology: [/(माफ़?\s*कर\w*|गलती|\bmaafi?\b|\bmaaf\s*kar\w*|\bsorry\b)/i],
    goodMorning: [/(गुड\s*मॉर्निंग|सुप्रभात|\b(good\s*morning|gm|suprabhat)\b)/i],
    goodNight: [/(गुड\s*नाइट|शुभ\s*रात्रि|\b(good\s*night|gn|shubh\s*ratri)\b)/i],
    affection: [/मैं\s*तुमसे\s*प्यार/i, /\bi\s*love\s*you\b/i, /\bilu\b/i, /\bily\b/i, /\bjaan\b/i, /\bjaanu\b/i, /\bbabu\b/i, /\bsona\b/i],
    topics: {
      work: ['काम', 'ऑफिस', 'मीटिंग', 'kaam', 'office', 'meeting', 'boss', 'project'],
      family: ['माँ', 'पापा', 'परिवार', 'mummy', 'papa', 'mom', 'dad', 'family', 'didi', 'bhai', 'bhaiya'],
      food: ['खाना', 'चाय', 'khana', 'chai', 'food', 'breakfast', 'lunch', 'dinner', 'bhook'],
      plans: ['कल', 'आज', 'kal', 'aaj', 'weekend', 'plan', 'milte', 'milna'],
      feelings: ['थका', 'खुश', 'दुखी', 'thak', 'khush', 'stress', 'tense', 'mood'],
      money: ['पैसा', 'paisa', 'paise', 'rent', 'bill'],
      relationship: ['हम', 'साथ', 'hum', 'saath', 'rishta', 'future'],
    },
  },

  ar: {
    positive: ['حب', 'شكرا', 'جميل', 'رائع', 'سعيد', 'ممتاز', 'كويس'],
    negative: ['حزين', 'غاضب', 'تعبان', 'آسف', 'زعلان', 'مشكلة'],
    apology: [/(آسف\w*|معذرة|\bsorry\b)/i],
    goodMorning: [/(صباح\s*الخير|\bgm\b)/i],
    goodNight: [/(تصبح\s*على\s*خير|ليلة\s*سعيدة|\bgn\b)/i],
    affection: [/أحبك/i, /حبيب[ي|تي]/i, /اشتقت/i],
    topics: {
      work: ['شغل', 'عمل', 'مكتب', 'اجتماع', 'مشروع'],
      family: ['ماما', 'بابا', 'أم', 'أب', 'عائلة', 'أخت', 'أخ'],
      food: ['أكل', 'فطور', 'غداء', 'عشاء', 'قهوة', 'جوعان'],
      plans: ['الليلة', 'بكرا', 'بكرة', 'ويكند', 'موعد'],
      feelings: ['تعبان', 'سعيد', 'حزين', 'مكتئب'],
      money: ['فلوس', 'إيجار', 'فاتورة'],
      relationship: ['إحنا', 'مع بعض', 'علاقة', 'مستقبل'],
    },
  },

  ru: {
    positive: ['люблю', 'хорошо', 'спасибо', 'красиво', 'счастлив', 'прекрасно', 'класс', 'отлично'],
    negative: ['грустно', 'злой', 'устал', 'ненавижу', 'извини', 'обидно', 'плохо'],
    apology: [/(извини\w*|прост\w*|прошу\s*прощения|моя\s*вина|\bsorry\b)/i],
    goodMorning: [/(доброе\s*утро|\b(ду|gm)\b)/i],
    goodNight: [/(спокойной\s*ночи|доброй\s*ночи|\b(сн|gn)\b)/i],
    affection: [/я\s*тебя\s*люблю/i, /я\s*скучаю/i, /люблю\s*тебя/i, /\bмилая\b/i, /\bмилый\b/i],
    topics: {
      work: ['работа', 'офис', 'встреча', 'проект', 'начальник'],
      family: ['мама', 'папа', 'семья', 'сестра', 'брат', 'родители'],
      food: ['еда', 'обед', 'ужин', 'завтрак', 'кофе', 'голод'],
      plans: ['сегодня', 'завтра', 'выходные', 'план', 'встреча'],
      feelings: ['чувствую', 'устал', 'счастлив', 'грустно', 'стресс'],
      money: ['деньги', 'счет', 'аренда'],
      relationship: ['мы', 'вместе', 'будущее', 'серьезно', 'отношения'],
    },
  },

  tr: {
    positive: ['aşk', 'sevgi', 'haha', 'teşekkür', 'güzel', 'mutlu', 'harika', 'mükemmel', 'iyi'],
    negative: ['üzgün', 'kızgın', 'yorgun', 'nefret', 'özür', 'kavga'],
    apology: [/(özür\s*dilerim|afedersin\w*|benim\s*hatam|\bsorry\b)/i],
    goodMorning: [/(günaydın|\bgm\b)/i],
    goodNight: [/(iyi\s*geceler|\bgn\b)/i],
    affection: [/seni\s*seviyorum/i, /seni\s*özledim/i, /aşkım/i, /canım/i],
    topics: {
      work: ['iş', 'ofis', 'toplantı', 'proje', 'patron'],
      family: ['anne', 'baba', 'aile', 'kardeş'],
      food: ['yemek', 'kahvaltı', 'akşam', 'kahve', 'aç'],
      plans: ['bu akşam', 'yarın', 'hafta sonu', 'plan', 'randevu'],
      feelings: ['yorgun', 'mutlu', 'üzgün', 'stresli'],
      money: ['para', 'fatura', 'kira'],
      relationship: ['biz', 'birlikte', 'gelecek', 'ciddi', 'ilişki'],
    },
  },

  id: {
    positive: ['cinta', 'sayang', 'haha', 'wkwk', 'terima kasih', 'makasih', 'cantik', 'bagus', 'keren', 'mantap'],
    negative: ['sedih', 'marah', 'capek', 'benci', 'maaf', 'kesal'],
    apology: [/\b(maaf|sorry|salah\s*ku)\b/i],
    goodMorning: [/\b(selamat\s*pagi|pagi|gm)\b/i],
    goodNight: [/\b(selamat\s*malam|gn)\b/i],
    affection: [/\baku\s*cinta\s*kamu\b/i, /\bsayang\b/i, /\bkangen\b/i, /\brindu\b/i],
    topics: {
      work: ['kerja', 'kantor', 'rapat', 'bos', 'proyek'],
      family: ['ibu', 'mama', 'bapak', 'ayah', 'keluarga', 'kakak', 'adik'],
      food: ['makan', 'sarapan', 'kopi', 'lapar'],
      plans: ['malam ini', 'besok', 'akhir pekan', 'rencana', 'kencan'],
      feelings: ['capek', 'bahagia', 'sedih', 'stres'],
      money: ['uang', 'tagihan', 'sewa'],
      relationship: ['kita', 'bersama', 'masa depan', 'serius', 'hubungan'],
    },
  },

  // CJK and other unsupported scripts use the minimal pack — keyword-based
  // sentiment / topic / apology detection is disabled. The structural stats
  // (timing, ghosting, response speed, vocab crossover, emoji affection)
  // still work fully.
  __minimal__: {
    positive: [],
    negative: [],
    apology: [],
    goodMorning: [],
    goodNight: [],
    affection: [],
    topics: {},
    minimal: true,
  },
};

export function getLanguagePack(code) {
  const pack = PACKS[code] || PACKS.__minimal__;
  return {
    code: PACKS[code] ? code : 'unknown',
    minimal: !!pack.minimal,
    positive: pack.positive,
    negative: pack.negative,
    apology: pack.apology,
    goodMorning: pack.goodMorning,
    goodNight: pack.goodNight,
    affectionText: pack.affection,
    affectionEmoji: UNIVERSAL_AFFECTION_EMOJI,
    topics: pack.topics,
  };
}

export const SUPPORTED_LANGUAGES = Object.keys(PACKS).filter((k) => !k.startsWith('__'));

export function languageName(code) {
  return (
    {
      en: 'English',
      es: 'Spanish',
      pt: 'Portuguese',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      nl: 'Dutch',
      tr: 'Turkish',
      id: 'Indonesian',
      hi: 'Hindi/Hinglish',
      ar: 'Arabic',
      he: 'Hebrew',
      ru: 'Russian',
      ko: 'Korean',
      ja: 'Japanese',
      zh: 'Chinese',
      th: 'Thai',
    }[code] || `unknown (${code})`
  );
}
