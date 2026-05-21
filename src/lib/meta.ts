import fs from "node:fs";
import path from "node:path";
import {
  EmulatorSchema,
  SubmissionSchema,
  type Emulator,
  type GameRef,
  type Screenshot,
  type Submission,
} from "./schema";

const META_ROOT = path.resolve(process.cwd(), "meta");

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function formatTimestamp(iso: string): string {
  if (iso.length < 16) return iso;
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function getEmulators(): Emulator[] {
  const dir = path.join(META_ROOT, "emulators");
  if (!fs.existsSync(dir)) return [];
  const list = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed = EmulatorSchema.safeParse(readJson(path.join(dir, f)));
      if (!parsed.success) throw new Error(`invalid emulators/${f}: ${parsed.error.message}`);
      return parsed.data;
    });
  list.sort((a, b) => a.slug.localeCompare(b.slug));
  return list;
}

export function getCommits(emulator: string): Submission[] {
  const dir = path.join(META_ROOT, "submissions", emulator);
  if (!fs.existsSync(dir)) return [];
  const list = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed = SubmissionSchema.safeParse(readJson(path.join(dir, f)));
      if (!parsed.success) throw new Error(`invalid submissions/${emulator}/${f}: ${parsed.error.message}`);
      return parsed.data;
    });
  list.sort((a, b) => b.commit_timestamp.localeCompare(a.commit_timestamp));
  return list;
}

export function getSubmission(emulator: string, commitShort: string): Submission | null {
  return getCommits(emulator).find((s) => s.commit_short === commitShort) ?? null;
}

export interface GameRow {
  game: GameRef;
  frames: Screenshot[];
}

export type FrameDiff =
  | { kind: "added"; frame: Screenshot }
  | { kind: "removed"; frame: Screenshot }
  | { kind: "changed"; a: Screenshot; b: Screenshot }
  | { kind: "same"; a: Screenshot; b: Screenshot };

export type GameDiff =
  | { kind: "game-added"; game: GameRef; bFrames: Screenshot[] }
  | { kind: "game-removed"; game: GameRef; aFrames: Screenshot[] }
  | {
      kind: "gained-screenshots";
      game: GameRef;
      bFrames: Screenshot[];
    }
  | {
      kind: "lost-screenshots";
      game: GameRef;
      aFrames: Screenshot[];
    }
  | {
      kind: "frames-changed";
      game: GameRef;
      aFrames: Screenshot[];
      bFrames: Screenshot[];
      perFrame: FrameDiff[];
      addedCount: number;
      removedCount: number;
      changedCount: number;
    };

export interface Diff {
  a: Submission;
  b: Submission;
  groups: {
    gameAdded: GameDiff[];
    gameRemoved: GameDiff[];
    gainedScreenshots: GameDiff[];
    lostScreenshots: GameDiff[];
    framesChanged: GameDiff[];
  };
  totals: {
    gameAdded: number;
    gameRemoved: number;
    gainedScreenshots: number;
    lostScreenshots: number;
    framesChanged: number;
  };
}

function framesByGame(sub: Submission): Map<string, Screenshot[]> {
  const m = new Map<string, Screenshot[]>();
  for (const s of sub.screenshots) {
    const arr = m.get(s.game_id);
    if (arr) arr.push(s);
    else m.set(s.game_id, [s]);
  }
  for (const arr of m.values()) arr.sort((x, y) => x.frame_index - y.frame_index);
  return m;
}

export function getDiff(emulator: string, aShort: string, bShort: string): Diff | null {
  const a = getSubmission(emulator, aShort);
  const b = getSubmission(emulator, bShort);
  if (!a || !b) return null;

  const aGames = new Map(a.games.map((g) => [g.game_id, g]));
  const bGames = new Map(b.games.map((g) => [g.game_id, g]));
  const aFrames = framesByGame(a);
  const bFrames = framesByGame(b);

  const groups: Diff["groups"] = {
    gameAdded: [],
    gameRemoved: [],
    gainedScreenshots: [],
    lostScreenshots: [],
    framesChanged: [],
  };

  const allIds = new Set<string>([...aGames.keys(), ...bGames.keys()]);
  for (const id of allIds) {
    const aGame = aGames.get(id);
    const bGame = bGames.get(id);
    const aF = aFrames.get(id) ?? [];
    const bF = bFrames.get(id) ?? [];

    if (!aGame && bGame) {
      groups.gameAdded.push({ kind: "game-added", game: bGame, bFrames: bF });
      continue;
    }
    if (aGame && !bGame) {
      groups.gameRemoved.push({ kind: "game-removed", game: aGame, aFrames: aF });
      continue;
    }
    if (!aGame || !bGame) continue;

    if (aF.length === 0 && bF.length > 0) {
      groups.gainedScreenshots.push({ kind: "gained-screenshots", game: bGame, bFrames: bF });
      continue;
    }
    if (aF.length > 0 && bF.length === 0) {
      groups.lostScreenshots.push({ kind: "lost-screenshots", game: aGame, aFrames: aF });
      continue;
    }
    if (aF.length === 0 && bF.length === 0) continue;

    const aByIdx = new Map(aF.map((f) => [f.frame_index, f]));
    const bByIdx = new Map(bF.map((f) => [f.frame_index, f]));
    const allIdx = Array.from(new Set([...aByIdx.keys(), ...bByIdx.keys()])).sort((x, y) => x - y);
    const perFrame: FrameDiff[] = [];
    let addedCount = 0;
    let removedCount = 0;
    let changedCount = 0;
    for (const idx of allIdx) {
      const fa = aByIdx.get(idx);
      const fb = bByIdx.get(idx);
      if (fa && !fb) {
        perFrame.push({ kind: "removed", frame: fa });
        removedCount++;
      } else if (!fa && fb) {
        perFrame.push({ kind: "added", frame: fb });
        addedCount++;
      } else if (fa && fb) {
        if (fa.sha256 !== fb.sha256) {
          perFrame.push({ kind: "changed", a: fa, b: fb });
          changedCount++;
        } else {
          perFrame.push({ kind: "same", a: fa, b: fb });
        }
      }
    }
    if (addedCount === 0 && removedCount === 0 && changedCount === 0) continue;
    groups.framesChanged.push({
      kind: "frames-changed",
      game: bGame,
      aFrames: aF,
      bFrames: bF,
      perFrame,
      addedCount,
      removedCount,
      changedCount,
    });
  }

  const sortByTitle = (x: GameDiff, y: GameDiff) =>
    x.game.game_title.localeCompare(y.game.game_title);
  groups.gameAdded.sort(sortByTitle);
  groups.gameRemoved.sort(sortByTitle);
  groups.gainedScreenshots.sort(sortByTitle);
  groups.lostScreenshots.sort(sortByTitle);
  groups.framesChanged.sort(sortByTitle);

  return {
    a,
    b,
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

export function getGameRows(emulator: string, commitShort: string): GameRow[] {
  const sub = getSubmission(emulator, commitShort);
  if (!sub) return [];
  const framesByGame = new Map<string, Screenshot[]>();
  for (const s of sub.screenshots) {
    const arr = framesByGame.get(s.game_id);
    if (arr) arr.push(s);
    else framesByGame.set(s.game_id, [s]);
  }
  for (const arr of framesByGame.values()) {
    arr.sort((a, b) => a.frame_index - b.frame_index);
  }
  const rows: GameRow[] = sub.games.map((g) => ({
    game: g,
    frames: framesByGame.get(g.game_id) ?? [],
  }));
  rows.sort((a, b) => {
    const aHas = a.frames.length > 0;
    const bHas = b.frames.length > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return a.game.game_title.localeCompare(b.game.game_title);
  });
  return rows;
}
