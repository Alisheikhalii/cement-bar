// Pure queue algorithms (no I/O, no Date.now).
export * from './bag';
export * from './bulk';

/** Bumped whenever allocation semantics change; persisted in `allocation_runs.engineVersion`. */
export const ENGINE_VERSION = '0.2.0';
