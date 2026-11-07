export const GEMINI_FALLBACK_MODELS = Object.freeze([
  'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'
]);
export const MAX_FALLBACK_CANDIDATES = 3;

const MAX_CATALOG_IDS = 5000;
const compare = (first, second) => first < second ? -1 : first > second ? 1 : 0;

function modelParts(value) {
  if (typeof value !== 'string' || !value.length || value.length > 200) return null;
  let body = value.trim();
  if (body.includes('/')) {
    const namespaced = /^(?:google|models)\/([^/]+)$/i.exec(body);
    if (!namespaced) return null;
    body = namespaced[1];
  }
  if (!/^gemini(?:[-_\s]|\d|$)/i.test(body)) return null;
  return { body: body.toLowerCase() };
}

export function isGeminiModel(value) {
  return modelParts(value) !== null;
}

function normalizedModel(value) {
  const parts = modelParts(value);
  if (!parts || !/^[a-z0-9._\s-]+$/.test(parts.body)) return null;
  return parts.body.replace(/[-_\s]/g, '');
}

function sameNumbers(first, second) {
  // Keep decimal/version boundaries: 2.5, 2.0 and 25 are different sequences.
  return JSON.stringify(first.match(/\d+/g) || []) === JSON.stringify(second.match(/\d+/g) || []);
}

function oneEditApart(first, second) {
  if (first === second || Math.abs(first.length - second.length) > 1) return false;
  let left = 0, right = 0, edits = 0;
  while (left < first.length && right < second.length) {
    if (first[left] === second[right]) { left++; right++; continue; }
    if (++edits > 1) return false;
    if (first.length >= second.length) left++;
    if (second.length >= first.length) right++;
  }
  return edits + Number(left < first.length || right < second.length) === 1;
}

function isCorrection(candidate, current) {
  return candidate !== null && current !== null
    && !/(?:image|audio|tts|live|embedding|thinking)/.test(candidate)
    && (candidate === current
      || (/\d/.test(current) && sameNumbers(candidate, current) && oneEditApart(candidate, current)));
}

// Only known text Flash forms qualify for a change to a different model. Dates,
// revisions and preview/lite variants come from the catalog, never ID guessing.
const date = '(?:\\d{4}-\\d{2}-\\d{2}|\\d{2}-\\d{2}|\\d{2}-\\d{4}|\\d{8})';
const revisionOrDate = `(?:\\d{3}|${date})`;
const flashShape = new RegExp(`^gemini-(?:flash(?:-lite)?-latest|\\d+(?:\\.\\d+)*-flash(?:-lite)?(?:-latest|-${revisionOrDate}|-preview(?:-${revisionOrDate})?)?)$`);

function flashDetails(value) {
  const parts = modelParts(value);
  if (!parts) return null;
  const canonical = parts.body.replace(/[_\s-]+/g, '-').replace(/^gemini(?=\d)/, 'gemini-');
  if (!flashShape.test(canonical)) return null;
  const preferred = GEMINI_FALLBACK_MODELS.indexOf(canonical);
  return { canonical, preferred: preferred < 0 ? GEMINI_FALLBACK_MODELS.length : preferred,
    variant: /-(?:preview|lite)(?:-|$)/.test(canonical) ? 1 : 0 };
}

// This is a scope guard for a trusted resolver. The selector below additionally
// establishes catalog membership, exact-current presence and typo uniqueness.
export function isAllowedFallbackModel(candidate, currentModel) {
  return candidate !== currentModel && isGeminiModel(currentModel) && (
    flashDetails(candidate) !== null
    || isCorrection(normalizedModel(candidate), normalizedModel(currentModel))
  );
}

export function selectGeminiCandidates(ids, currentModel) {
  if (!isGeminiModel(currentModel) || (!Array.isArray(ids) && !(ids instanceof Set))
    || (Array.isArray(ids) ? ids.length : ids.size) > MAX_CATALOG_IDS) return [];
  const catalog = [...ids];
  if (catalog.some(id => typeof id !== 'string' || !id.length || id.length > 200)) return [];
  const originals = [...new Set(catalog)].filter(id => id !== currentModel).sort(compare);
  const current = normalizedModel(currentModel);
  const primaryAdvertised = catalog.includes(currentModel);
  let correction;
  if (!primaryAdvertised && current !== null) {
    const cosmetic = originals.filter(id => normalizedModel(id) === current
      && isCorrection(normalizedModel(id), current));
    if (cosmetic.length) {
      correction = cosmetic[0];
    } else {
      const targets = new Map();
      for (const id of originals) {
        const normalized = normalizedModel(id);
        if (isCorrection(normalized, current) && !targets.has(normalized)) targets.set(normalized, id);
      }
      // Aliases for one normalized model are one target; different equally close
      // spellings are ambiguous and must not choose the user's intended model.
      if (targets.size === 1) correction = targets.values().next().value;
    }
  }
  const flash = originals.filter(id => !primaryAdvertised || normalizedModel(id) !== current)
    .map(id => ({ id, details: flashDetails(id) })).filter(row => row.details)
    .sort((first, second) => first.details.preferred - second.details.preferred
      || first.details.variant - second.details.variant
      || compare(first.details.canonical, second.details.canonical) || compare(first.id, second.id));
  return [...new Set([...(correction ? [correction] : []), ...flash.map(row => row.id)])]
    .slice(0, MAX_FALLBACK_CANDIDATES);
}
