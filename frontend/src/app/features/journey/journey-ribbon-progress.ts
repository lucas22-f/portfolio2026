/** Maps section-local scroll progress to the normalized Journey ribbon timeline. */
export function mapJourneyRibbonProgress(
  sectionIndex: number,
  sectionProgress: number,
  sectionCount: number,
): number {
  if (
    !Number.isInteger(sectionIndex) ||
    !Number.isInteger(sectionCount) ||
    sectionCount <= 1 ||
    sectionIndex < 0 ||
    sectionIndex >= sectionCount
  ) {
    return 0;
  }

  const localProgress = Number.isFinite(sectionProgress)
    ? Math.min(1, Math.max(0, sectionProgress))
    : 0;
  return Math.min(1, (sectionIndex + localProgress) / (sectionCount - 1));
}
