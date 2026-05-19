/**
 * Normalizes a classification string to only include up to the second level.
 * Example: "PROPAGADO > PSICO ÉTICOS > C1" → "PROPAGADO > PSICO ÉTICOS"
 * Example: "PERFUMARIA > MAOS E PES > ESMALTES/BASES > COLORAMA" → "PERFUMARIA > MAOS E PES"
 * Example: "PERFUMARIA" → "PERFUMARIA" (single level, unchanged)
 */
export function normalizeClassification(classification: string): string {
  if (!classification) return classification;

  const parts = classification.split(' > ');

  // Keep only up to the second level
  if (parts.length <= 2) {
    return classification;
  }

  return `${parts[0]} > ${parts[1]}`;
}

/**
 * Normalizes an array of classification strings to only include up to the second level.
 */
export function normalizeClassifications(classifications: string[] | undefined | null): string[] | undefined {
  if (!classifications || classifications.length === 0) {
    return undefined;
  }

  // Normalize and deduplicate
  const normalized = [...new Set(classifications.map(normalizeClassification))];
  return normalized;
}
