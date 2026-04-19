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
