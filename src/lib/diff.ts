export type CompactFrame = [number, string, number, number];
export type CompactDemo = [string, number, number];

export interface CommitData {
  emulator: string;
  commit: string;
  commit_short: string;
  commit_message: string;
  commit_timestamp: string;
  games: [string, string][];
  shots: Record<string, CompactFrame[]>;
  // Per-game demo gif, keyed by game_id: [r2_key, width, height].
  demos: Record<string, CompactDemo>;
}

export interface Frame {
  i: number;
  key: string;
  w: number;
  h: number;
}

export type PerFrame =
  | { k: "s"; b: Frame }
  | { k: "a"; f: Frame }
  | { k: "r"; f: Frame }
  | { k: "c"; a: Frame; b: Frame };

export type DiffEntry =
  | { kind: "game-added"; id: string; title: string; frames: Frame[] }
  | { kind: "game-removed"; id: string; title: string; frames: Frame[] }
  | { kind: "gained-screenshots"; id: string; title: string; frames: Frame[] }
  | { kind: "lost-screenshots"; id: string; title: string; frames: Frame[] }
  | {
      kind: "frames-changed";
      id: string;
      title: string;
      perFrame: PerFrame[];
      addedCount: number;
      removedCount: number;
      changedCount: number;
    };

export interface DiffGroups {
  gameAdded: DiffEntry[];
  gameRemoved: DiffEntry[];
  gainedScreenshots: DiffEntry[];
  lostScreenshots: DiffEntry[];
  framesChanged: DiffEntry[];
}

export interface DiffResult {
  groups: DiffGroups;
  totals: Record<keyof DiffGroups, number>;
}

function framesOf(data: CommitData, id: string): Frame[] {
  const raw = data.shots[id];
  if (!raw) return [];

  // toCommitData already sorts by frame_index, but be defensive.
  return raw
    .map(([i, key, w, h]) => ({ i, key, w, h }))
    .sort((a, b) => a.i - b.i);
}

export interface DiffOptions {
  // Frames below this index are BIOS/boot animation and don't count towards
  // gained/lost screenshot detection. Defaults to 0 (consider all frames).
  firstGameFrame?: number;
}

export function computeDiff(a: CommitData, b: CommitData, opts: DiffOptions = {}): DiffResult {
  const firstGameFrame = opts.firstGameFrame ?? 0;
  const aGames = new Map(a.games);
  const bGames = new Map(b.games);

  const groups: DiffGroups = {
    gameAdded: [],
    gameRemoved: [],
    gainedScreenshots: [],
    lostScreenshots: [],
    framesChanged: [],
  };

  const allIds = new Set<string>([...aGames.keys(), ...bGames.keys()]);
  for (const id of allIds) {
    const aTitle = aGames.get(id);
    const bTitle = bGames.get(id);
    const inA = aTitle !== undefined;
    const inB = bTitle !== undefined;
    const aF = framesOf(a, id);
    const bF = framesOf(b, id);

    if (!inA && inB) {
      groups.gameAdded.push({ kind: "game-added", id, title: bTitle, frames: bF });
      continue;
    }
    if (inA && !inB) {
      groups.gameRemoved.push({ kind: "game-removed", id, title: aTitle, frames: aF });
      continue;
    }
    if (!inA || !inB) continue;

    const title = bTitle;

    // Only frames past the boot sequence count as "having screenshots";
    // every game produces BIOS frames, so without this gained/lost never fires.
    const aGameF = aF.filter((f) => f.i >= firstGameFrame);
    const bGameF = bF.filter((f) => f.i >= firstGameFrame);

    if (aGameF.length === 0 && bGameF.length > 0) {
      groups.gainedScreenshots.push({ kind: "gained-screenshots", id, title, frames: bGameF });
      continue;
    }
    if (aGameF.length > 0 && bGameF.length === 0) {
      groups.lostScreenshots.push({ kind: "lost-screenshots", id, title, frames: aGameF });
      continue;
    }
    if (aF.length === 0 && bF.length === 0) continue;

    const aByIdx = new Map(aF.map((f) => [f.i, f]));
    const bByIdx = new Map(bF.map((f) => [f.i, f]));
    const allIdx = Array.from(new Set([...aByIdx.keys(), ...bByIdx.keys()])).sort((x, y) => x - y);

    const perFrame: PerFrame[] = [];
    let addedCount = 0;
    let removedCount = 0;
    let changedCount = 0;
    for (const idx of allIdx) {
      const fa = aByIdx.get(idx);
      const fb = bByIdx.get(idx);
      if (fa && !fb) {
        perFrame.push({ k: "r", f: fa });
        removedCount++;
      } else if (!fa && fb) {
        perFrame.push({ k: "a", f: fb });
        addedCount++;
      } else if (fa && fb) {
        if (fa.key !== fb.key) {
          perFrame.push({ k: "c", a: fa, b: fb });
          changedCount++;
        } else {
          perFrame.push({ k: "s", b: fb });
        }
      }
    }

    if (addedCount === 0 && removedCount === 0 && changedCount === 0) continue;

    groups.framesChanged.push({
      kind: "frames-changed",
      id,
      title,
      perFrame,
      addedCount,
      removedCount,
      changedCount,
    });
  }

  const byTitle = (x: DiffEntry, y: DiffEntry) => x.title.localeCompare(y.title);
  groups.gameAdded.sort(byTitle);
  groups.gameRemoved.sort(byTitle);
  groups.gainedScreenshots.sort(byTitle);
  groups.lostScreenshots.sort(byTitle);
  groups.framesChanged.sort(byTitle);

  return {
    groups,
    totals: {
      gameAdded: groups.gameAdded.length,
      gameRemoved: groups.gameRemoved.length,
      gainedScreenshots: groups.gainedScreenshots.length,
      lostScreenshots: groups.lostScreenshots.length,
      framesChanged: groups.framesChanged.length,
    },
  };
}

export function formatTimestamp(iso: string): string {
  if (iso.length < 16) return iso;
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
