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
import type { CommitData, CompactFrame } from "./diff";

const META_ROOT = path.resolve(process.cwd(), "meta");

const USE_CACHE = !import.meta.env.DEV;
let emulatorsCache: Emulator[] | null = null;
const commitsCache = new Map<string, Submission[]>();

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function formatTimestamp(iso: string): string {
  if (iso.length < 16) return iso;
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function getEmulators(): Emulator[] {
  if (emulatorsCache) return emulatorsCache;

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

  if (USE_CACHE) emulatorsCache = list;

  return list;
}

export function getCommits(emulator: string): Submission[] {
  const cached = commitsCache.get(emulator);
  if (cached) return cached;

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

  if (USE_CACHE) commitsCache.set(emulator, list);

  return list;
}

export function getSubmission(emulator: string, commitShort: string): Submission | null {
  return getCommits(emulator).find((s) => s.commit_short === commitShort) ?? null;
}

// Counts games with at least one frame from `firstGameFrame` onwards. With the
// default of 0 this is simply "has any screenshot"; with an emulator's
// first_game_frame set, BIOS-only games no longer count.
export function countGamesWithFrames(sub: Submission, firstGameFrame = 0): number {
  const ids = new Set<string>();

  for (const s of sub.screenshots) {
    if (s.frame_index >= firstGameFrame) ids.add(s.game_id);
  }

  return ids.size;
}

export function toCommitData(emulator: string, commitShort: string): CommitData | null {
  const sub = getSubmission(emulator, commitShort);
  if (!sub) return null;

  const shots: Record<string, CompactFrame[]> = {};
  for (const s of sub.screenshots) {
    (shots[s.game_id] ??= []).push([s.frame_index, s.r2_key, s.width, s.height]);
  }
  
  for (const arr of Object.values(shots)) arr.sort((x, y) => x[0] - y[0]);
  
  return {
    emulator: sub.emulator,
    commit: sub.commit,
    commit_short: sub.commit_short,
    commit_message: sub.commit_message,
    commit_timestamp: sub.commit_timestamp,
    games: sub.games.map((g) => [g.game_id, g.game_title]),
    shots,
  };
}

export interface GameRow {
  game: GameRef;
  frames: Screenshot[];
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
