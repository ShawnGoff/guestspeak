/**
 * Types shared between the session page and the pieces lifted out of it.
 *
 * Here rather than in whichever component moved last, so neither side has to
 * import from the other — the shape of a cycle this refactor is avoiding.
 */

export type SortOption = 'echoes' | 'recent' | 'answered' | 'starred' | 'hidden';
