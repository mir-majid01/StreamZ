import {
  BudgetExceededError,
  deriveStage,
  isBudgetFailure,
  withinBudget,
  type StageSignals,
} from '@/src/utils/sourceResolution';

const signals = (over: Partial<StageSignals> = {}): StageSignals => ({
  failed: false,
  hasSource: false,
  confirmed: false,
  resolving: false,
  candidatesPending: false,
  ...over,
});

describe('deriveStage', () => {
  it('is checking before any host has answered', () => {
    expect(deriveStage(signals())).toBe('checking');
    expect(deriveStage(signals({ candidatesPending: true }))).toBe('available');
    expect(deriveStage(signals({ resolving: true }))).toBe('resolving');
  });

  it('never calls a candidate playing just because it returned a URL', () => {
    expect(deriveStage(signals({ hasSource: true }))).toBe('starting');
    expect(deriveStage(signals({ hasSource: true, confirmed: false }))).toBe('starting');
  });

  it('calls it playing only once the player confirmed that source', () => {
    expect(deriveStage(signals({ hasSource: true, confirmed: true }))).toBe('playing');
  });

  it('reports failure over a stale confirmed source', () => {
    expect(
      deriveStage(signals({ failed: true, hasSource: true, confirmed: true })),
    ).toBe('failed');
  });
});

describe('withinBudget', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes a task that finishes in time through untouched', async () => {
    const pending = withinBudget(() => Promise.resolve('uri'), 5000);
    await expect(pending).resolves.toBe('uri');
  });

  it('rejects with a budget failure when the task overruns', async () => {
    const pending = withinBudget(() => new Promise<string>(() => {}), 5000);
    jest.advanceTimersByTime(5001);
    await expect(pending).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(pending).rejects.toThrow(/5000ms budget/);
    expect(isBudgetFailure(new BudgetExceededError(1))).toBe(true);
    expect(isBudgetFailure(new Error('boom'))).toBe(false);
  });

  it('drops a result that arrives after the budget instead of applying it late', async () => {
    let settle: (value: string) => void = () => {};
    const pending = withinBudget(() => new Promise<string>((res) => { settle = res; }), 5000);
    jest.advanceTimersByTime(5001);
    await expect(pending).rejects.toBeInstanceOf(BudgetExceededError);
    settle('too late');
    // The promise already rejected; the late value must not resurrect it.
    await expect(pending).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('clears the timer on success so it cannot reject afterwards', async () => {
    const pending = withinBudget(() => Promise.resolve('ok'), 5000);
    await expect(pending).resolves.toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(60_000);
    await expect(pending).resolves.toBe('ok');
  });

  it('re-raises the underlying task error rather than a budget failure', async () => {
    const boom = new Error('host refused');
    const pending = withinBudget(() => Promise.reject(boom), 5000);
    await expect(pending).rejects.toBe(boom);
    expect(jest.getTimerCount()).toBe(0);
  });
});
