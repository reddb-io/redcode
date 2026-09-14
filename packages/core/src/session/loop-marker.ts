/**
 * How every loop-guard correction begins ("This is call 3 of `todowrite`…").
 *
 * Shared so the evidence gate can tell a guard quoting a refusal back to the model from the refusal
 * itself without importing the runtime's guard.
 */
export const LOOP_GUARD_REFUSAL = "This is call "
