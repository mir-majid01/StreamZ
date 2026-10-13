/**
 * A playback attempt has four genuinely different outcomes that the UI must not
 * conflate: the title is in the catalogue, hosts returned candidate streams, one
 * candidate yielded a URL, and the player actually started from that URL.
 * `deriveStage` collapses the screen's signals into the stage that is provably
 * true right now, so nothing is ever reported as playing on the strength of a
 * returned URL alone.
 */
export type SourceStage =
  | 'checking'
  | 'available'
  | 'resolving'
  | 'starting'
  | 'playing'
  | 'failed';

/**
 * Why the most recent attempt gave up. Kept apart from the stage because the
 * stage says where we are and this says what happened to the candidate before.
 * 'unknown' from the requirement set is deliberately absent: every exit in this
 * pipeline is either a host error or a wall-clock overrun, so there is nothing
 * yet that can only be described as indeterminate.
 */
export type FailureReason = 'error' | 'timed_out';

export interface StageSignals {
  /** Every server/candidate for this target has been exhausted. */
  failed: boolean;
  /** A resolved source has been handed to the player. */
  hasSource: boolean;
  /** The player emitted a real load event for *that* source. */
  confirmed: boolean;
  /** A specific candidate is being resolved right now. */
  resolving: boolean;
  /** Candidates exist for the target, none being resolved yet. */
  candidatesPending: boolean;
}

export function deriveStage(signals: StageSignals): SourceStage {
  if (signals.failed) return 'failed';
  if (signals.hasSource) return signals.confirmed ? 'playing' : 'starting';
  if (signals.resolving) return 'resolving';
  if (signals.candidatesPending) return 'available';
  return 'checking';
}

export class BudgetExceededError extends Error {
  constructor(budgetMs: number) {
    super(`Attempt exceeded its ${budgetMs}ms budget`);
    this.name = 'BudgetExceededError';
  }
}

/**
 * Run `task` with a wall-clock budget. The task itself is not cancellable (a
 * caller that can abort should pass its own signal), so a late result is simply
 * dropped: the returned promise has already rejected and whatever the task
 * eventually resolves to is discarded rather than applied to a newer attempt.
 */
export function withinBudget<T>(task: () => Promise<T>, budgetMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BudgetExceededError(budgetMs)), budgetMs);
    task().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function isBudgetFailure(error: unknown): boolean {
  return error instanceof BudgetExceededError;
}
