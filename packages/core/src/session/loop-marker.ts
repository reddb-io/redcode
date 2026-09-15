/**
 * How every loop-guard correction begins ("This is call 3 of `todowrite`…").
 *
 * Shared so the evidence gate can tell a guard quoting a refusal back to the model from the refusal
 * itself without importing the runtime's guard.
 */
export const LOOP_GUARD_REFUSAL = "This is call "

/**
 * How the reason of a goal the loop guard paused begins ("loop guard: task updates kept failing (8 in
 * a row)"). Resuming such a goal answers the guard, not a judge, so the continuation looks for it.
 */
export const LOOP_GUARD_PAUSE = "loop guard: "

/**
 * How the reason of a goal paused around a context compaction begins ("compaction guard: …").
 * Resuming such a goal answers the context pressure, not a judge, so the continuation looks for it.
 */
export const COMPACTION_GUARD_PAUSE = "compaction guard: "

/**
 * How the reason of a goal paused at its spend budget begins ("budget: $2.00 of $2.00 spent").
 * Resuming such a goal answers the budget, not a judge, so the continuation looks for it.
 */
export const BUDGET_PAUSE = "budget: "
