/**
 * Vietnamese Name Matching and Normalization Utility
 * Handles autocomplete suggestions, incomplete names matching, and surname/given name disambiguation.
 */

export function removeVietnameseTones(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function cleanName(name: string): string {
  if (!name) return '';
  return name.replace(/\s+/g, ' ').trim();
}

export interface NameParts {
  fullName: string;
  normalizedFull: string;
  normalizedNoTone: string;
  words: string[];
  wordsNoTone: string[];
  givenName: string; // Tên (từ cuối cùng)
  givenNameNoTone: string;
  familyName: string; // Họ (từ đầu tiên)
  familyNameNoTone: string;
  familyAndMiddle: string; // Họ và tên đệm
  familyAndMiddleNoTone: string;
}

export function parseNameParts(fullName: string): NameParts {
  const cleaned = cleanName(fullName);
  const words = cleaned.split(' ').filter(Boolean);
  const normalizedFull = cleaned.toLowerCase();
  const normalizedNoTone = removeVietnameseTones(cleaned);
  const wordsNoTone = normalizedNoTone.split(' ').filter(Boolean);

  const givenName = words.length > 0 ? words[words.length - 1] : '';
  const givenNameNoTone = wordsNoTone.length > 0 ? wordsNoTone[wordsNoTone.length - 1] : '';

  const familyName = words.length > 1 ? words[0] : '';
  const familyNameNoTone = wordsNoTone.length > 1 ? wordsNoTone[0] : '';

  const familyAndMiddle = words.length > 1 ? words.slice(0, -1).join(' ') : '';
  const familyAndMiddleNoTone = wordsNoTone.length > 1 ? wordsNoTone.slice(0, -1).join(' ') : '';

  return {
    fullName: cleaned,
    normalizedFull,
    normalizedNoTone,
    words,
    wordsNoTone,
    givenName,
    givenNameNoTone,
    familyName,
    familyNameNoTone,
    familyAndMiddle,
    familyAndMiddleNoTone
  };
}

/**
 * Matches a student's submitted name (potentially incomplete, e.g. "An", "Nguyen An", "Bình")
 * against the class roster.
 * Prioritizes:
 * 1. Exact match (with or without diacritics)
 * 2. Exact Given Name (Tên chính) if unique in class
 * 3. If Given Name is duplicated in class -> compare Family name (Họ) / Middle name (Tên đệm)
 */
export function matchResultToRoster(
  resultName: string,
  roster: string[]
): string | null {
  if (!resultName || !roster || roster.length === 0) return null;

  const target = parseNameParts(resultName);
  if (!target.fullName) return null;

  const parsedRoster = roster.map(name => parseNameParts(name));

  // 1. Exact match (case insensitive)
  const exactMatch = parsedRoster.find(
    r => r.normalizedFull === target.normalizedFull
  );
  if (exactMatch) return exactMatch.fullName;

  // 2. Exact match without tones
  const exactNoToneMatch = parsedRoster.find(
    r => r.normalizedNoTone === target.normalizedNoTone
  );
  if (exactNoToneMatch) return exactNoToneMatch.fullName;

  // 3. Match by Given Name (Tên)
  // Find all students in roster whose given name matches target given name
  const sameGivenName = parsedRoster.filter(
    r =>
      r.givenName.toLowerCase() === target.givenName.toLowerCase() ||
      r.givenNameNoTone === target.givenNameNoTone
  );

  if (sameGivenName.length === 1) {
    // Only 1 student in class has this given name (e.g. only 1 student named "Bình" or "Lan")
    return sameGivenName[0].fullName;
  }

  if (sameGivenName.length > 1) {
    // Multiple students have the same given name (e.g. "Nguyễn Văn An" vs "Phạm Văn An")
    // Prioritize by matching family name (Họ) or middle name words
    let bestMatch: NameParts | null = null;
    let highestScore = -1;

    for (const candidate of sameGivenName) {
      let score = 0;

      // Check if target has family name matching candidate family name
      if (target.familyName && candidate.familyName) {
        if (target.familyName.toLowerCase() === candidate.familyName.toLowerCase()) {
          score += 10;
        } else if (target.familyNameNoTone === candidate.familyNameNoTone) {
          score += 8;
        }
      }

      // Check common words in target and candidate
      for (const tWord of target.wordsNoTone) {
        if (candidate.wordsNoTone.includes(tWord)) {
          score += 5;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = candidate;
      }
    }

    if (bestMatch && highestScore > 0) {
      return bestMatch.fullName;
    }

    // Fallback: return the first one if completely ambiguous
    return sameGivenName[0].fullName;
  }

  // 4. Substring or word matching (e.g. student typed "Nguyen Van" or initials)
  const partialMatches = parsedRoster.filter(r =>
    r.normalizedNoTone.includes(target.normalizedNoTone) ||
    target.normalizedNoTone.includes(r.normalizedNoTone)
  );

  if (partialMatches.length === 1) {
    return partialMatches[0].fullName;
  }

  return null;
}

/**
 * Autocomplete / Suggestion filter for input dropdown in Quiz
 */
export function getRosterSuggestions(
  input: string,
  roster: string[]
): string[] {
  if (!roster || roster.length === 0) return [];
  if (!input || !input.trim()) return roster.slice(0, 20);

  const cleanInput = cleanName(input);
  const inputNoTone = removeVietnameseTones(cleanInput);

  return roster.filter(name => {
    const cleanRosterName = cleanName(name);
    const rosterNoTone = removeVietnameseTones(cleanRosterName);

    // Direct contains
    if (rosterNoTone.includes(inputNoTone)) return true;

    // Check given name (e.g. typing "An" matches "Nguyễn Văn An")
    const parts = parseNameParts(name);
    if (parts.givenNameNoTone.startsWith(inputNoTone) || parts.givenNameNoTone.includes(inputNoTone)) {
      return true;
    }

    // Check first letters of each word (acronym/initials, e.g. "nva" matches "Nguyễn Văn An")
    const initials = parts.wordsNoTone.map(w => w[0]).join('');
    if (initials.includes(inputNoTone)) return true;

    return false;
  });
}
