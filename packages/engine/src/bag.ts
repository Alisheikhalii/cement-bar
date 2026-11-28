/**
 * Pure bag-allocation algorithm (SPEC §3.3, BR-K4). No I/O, no Date.now.
 *
 * Turns are walked in `turnNo` order — the server-clock registration order — and each turn takes
 * the first of its ranked priorities that still has an open unit. A turn without any available
 * priority is reported as not allocated.
 */

export interface BagTurnInput {
  turnNo: number;
  driverId: string;
  /** Announcement ids in priority order (rank 1 first). */
  priorities: readonly string[];
}

export interface BagAllocateInput {
  turns: readonly BagTurnInput[];
  /** announcementId → open unit ids, in `seq` order (consumed FIFO). */
  stock: Readonly<Record<string, readonly string[]>>;
}

export interface BagAssignment {
  driverId: string;
  unitId: string;
  announcementId: string;
  /** 1-based rank of the priority that matched. */
  rank: number;
}

export interface BagAllocateResult {
  assignments: BagAssignment[];
  notAllocated: string[];
  /** Stock left after allocation (useful to mark leftover units KEEP/AUTO_FREE). */
  remainingStock: Record<string, string[]>;
}

function cloneStock(stock: BagAllocateInput['stock']): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [announcementId, units] of Object.entries(stock)) out.set(announcementId, [...units]);
  return out;
}

export function allocateBag(input: BagAllocateInput): BagAllocateResult {
  const stock = cloneStock(input.stock);
  const turns = [...input.turns].sort((a, b) => a.turnNo - b.turnNo);
  const assignments: BagAssignment[] = [];
  const notAllocated: string[] = [];

  for (const turn of turns) {
    let assigned = false;
    for (const [index, announcementId] of turn.priorities.entries()) {
      const units = stock.get(announcementId);
      if (units && units.length > 0) {
        const unitId = units.shift();
        // `shift` on a non-empty array always yields a value.
        if (unitId !== undefined) {
          assignments.push({ driverId: turn.driverId, unitId, announcementId, rank: index + 1 });
          assigned = true;
          break;
        }
      }
    }
    if (!assigned) notAllocated.push(turn.driverId);
  }

  return { assignments, notAllocated, remainingStock: Object.fromEntries(stock) };
}
