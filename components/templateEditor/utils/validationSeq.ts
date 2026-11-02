/** Ignore a validate response when a newer request or clear() has superseded it. */
export const shouldApplyValidationSeq = (seq: number, latestSeq: number): boolean =>
  seq === latestSeq;
