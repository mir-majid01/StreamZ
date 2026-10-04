// Spec §2 and §16: these surfaces are hidden in Phase 1A by flag, not deleted.
// Flip a flag back to true to restore the corresponding code path.
export const FEATURES = {
  liveTv: false,
  watchParty: false,
  tvLayout: false,
  updateChecker: false,
} as const;
