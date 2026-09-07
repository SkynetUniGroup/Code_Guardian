import { FrancFn } from './franc.provider';

// RV.8: "un controllo leggero (una libreria di rilevamento lingua, non il
// modello)" on an excerpt of the README — this is that check.
const EXCERPT_LENGTH = 1000;

// Below this length, franc's own guidance is that detection is unreliable —
// a short README (or one that's mostly a title/badges) shouldn't produce a
// false "non-English" warning just because there wasn't enough text to
// judge.
const MIN_LENGTH_FOR_DETECTION = 20;

export function isReadmeNonEnglish(
  readmeContent: string,
  franc: FrancFn,
): boolean {
  const excerpt = readmeContent.trim().slice(0, EXCERPT_LENGTH);
  if (excerpt.length < MIN_LENGTH_FOR_DETECTION) {
    return false;
  }

  const detected = franc(excerpt);

  // 'und' = undetermined (franc itself isn't confident) — not a positive
  // non-English signal, so it doesn't warn either.
  return detected !== 'und' && detected !== 'eng';
}
