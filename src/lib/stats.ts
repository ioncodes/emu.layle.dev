import { getCommits, getEmulators } from "./meta";
import type { Emulator, Submission } from "./schema";

// dither-kit exposes these named hues. We hand out the vivid six by archive size
// (biggest gets the strongest colour) and keep grey for the smallest, so all
// seven series stay distinct and none of them collide.
export type DitherColor = "green" | "blue" | "purple" | "pink" | "orange" | "red" | "grey";

const COLOR_RAMP: DitherColor[] = ["green", "orange", "blue", "pink", "purple", "red", "grey"];

interface TrackedEmulator {
  slug: string;
  name: string;
  console: string;
  firstGameFrame: number;
  submissions: Submission[];
}

export interface EmulatorSummary {
  slug: string;
  name: string;
  console: string;
  color: DitherColor;
  submissionCount: number;
  latestCommit: string;
  gamesTotal: number;
  gamesCovered: number;
  gamesMissing: number;
  framesTotal: number;
}

export interface StatsOverview {
  totals: {
    emulators: number;
    submissions: number;
    frames: number;
    covered: number;
    missing: number;
  };
  perEmulator: EmulatorSummary[];
  // Series slugs ordered biggest archive first, so the stacked chart draws the
  // largest band at the bottom.
  seriesOrder: string[];
  // Maps each series slug to its label and colour, in the shape the charts want.
  config: Record<string, { label: string; color: DitherColor }>;
  // One row per month, keyed by emulator slug, holding the number of games that
  // emulator had covered as of that month. Fed to the coverage-over-time chart.
  coverageByMonth: Array<Record<string, number | string>>;
  // Latest per-emulator coverage, split into covered and missing games. `short`
  // uses an abbreviated console so it fits on the bar chart's x-axis.
  coverage: Array<{ emulator: string; short: string; covered: number; missing: number }>;
}

// Emulator names collide (both gecko builds are just "gecko"), so every chart
// label carries the console too.
function seriesLabel(name: string, console: string): string {
  return `${name} (${console})`;
}

const SHORT_CONSOLE: Record<string, string> = {
  "Game Boy Advance": "GBA",
  GameCube: "GameCube",
  Wii: "Wii",
  "PlayStation 2": "PS2",
  "PlayStation 1": "PS1",
  "Super Nintendo": "SNES",
  "Sega Saturn": "Saturn",
};

function shortLabel(name: string, console: string): string {
  return `${name} (${SHORT_CONSOLE[console] ?? console})`;
}

// Counts, among the games listed in a commit, how many have at least one
// screenshot at or after the emulator's first in-game frame.
function coveredGames(sub: Submission, firstGameFrame: number): number {
  const shot = new Set<string>();
  for (const s of sub.screenshots) {
    if (s.frame_index >= firstGameFrame) shot.add(s.game_id);
  }

  return sub.games.filter((g) => shot.has(g.game_id)).length;
}

function getTrackedEmulators(): TrackedEmulator[] {
  const emulators: Emulator[] = getEmulators();

  const tracked: TrackedEmulator[] = [];
  for (const e of emulators) {
    const submissions = getCommits(e.slug);
    if (submissions.length === 0) continue;

    tracked.push({
      slug: e.slug,
      name: e.name,
      console: e.console,
      firstGameFrame: e.first_game_frame ?? 0,
      submissions,
    });
  }

  return tracked;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

// Lists every "YYYY-MM" from first to last inclusive, so the timeline stays
// continuous across months with no submissions.
function monthRange(first: string, last: string): string[] {
  const [fy, fm] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);

  const months: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ly || (y === ly && m <= lm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return months;
}

export function getStatsOverview(): StatsOverview {
  const tracked = getTrackedEmulators();

  let submissions = 0;
  let frames = 0;

  // Per emulator, its coverage at each commit over time (month + covered count),
  // sorted oldest first so we can carry the latest value forward month by month.
  const coverageHistory = new Map<string, Array<{ month: string; covered: number }>>();
  let firstMonth: string | null = null;
  let lastMonth: string | null = null;

  for (const t of tracked) {
    const history: Array<{ month: string; covered: number }> = [];

    for (const sub of t.submissions) {
      submissions += 1;
      frames += sub.screenshots.length;

      const month = monthKey(sub.commit_timestamp);
      history.push({ month, covered: coveredGames(sub, t.firstGameFrame) });

      if (!firstMonth || month < firstMonth) firstMonth = month;
      if (!lastMonth || month > lastMonth) lastMonth = month;
    }

    history.sort((a, b) => a.month.localeCompare(b.month));
    coverageHistory.set(t.slug, history);
  }

  // Latest-commit coverage per emulator.
  const perEmulator: EmulatorSummary[] = tracked.map((t) => {
    const latest = t.submissions[0];
    const gamesTotal = latest.games.length;
    const gamesCovered = coveredGames(latest, t.firstGameFrame);

    return {
      slug: t.slug,
      name: t.name,
      console: t.console,
      color: "grey",
      submissionCount: t.submissions.length,
      latestCommit: latest.commit_short,
      gamesTotal,
      gamesCovered,
      gamesMissing: gamesTotal - gamesCovered,
      framesTotal: t.submissions.reduce((sum, s) => sum + s.screenshots.length, 0),
    };
  });

  // Rank by archive size so the biggest emulator gets the strongest colour and
  // sits at the bottom of the stack.
  perEmulator.sort((a, b) => b.framesTotal - a.framesTotal);
  perEmulator.forEach((e, i) => {
    e.color = COLOR_RAMP[i % COLOR_RAMP.length];
  });

  const seriesOrder = perEmulator.map((e) => e.slug);

  const config: StatsOverview["config"] = {};
  for (const e of perEmulator) {
    config[e.slug] = { label: seriesLabel(e.name, e.console), color: e.color };
  }

  // For each month, carry forward each emulator's most recent coverage. Games
  // covered is far more even across emulators than raw frame counts, so every
  // series stays visible in the stack.
  const months = firstMonth && lastMonth ? monthRange(firstMonth, lastMonth) : [];
  const cursor = new Map<string, number>();
  const latestCovered = new Map<string, number>();
  const coverageByMonth: Array<Record<string, number | string>> = months.map((month) => {
    const row: Record<string, number | string> = { month };

    for (const e of perEmulator) {
      const history = coverageHistory.get(e.slug) ?? [];
      let i = cursor.get(e.slug) ?? 0;
      while (i < history.length && history[i].month <= month) {
        latestCovered.set(e.slug, history[i].covered);
        i += 1;
      }
      cursor.set(e.slug, i);

      row[e.slug] = latestCovered.get(e.slug) ?? 0;
    }

    return row;
  });

  const coverage = perEmulator.map((e) => ({
    emulator: seriesLabel(e.name, e.console),
    short: shortLabel(e.name, e.console),
    covered: e.gamesCovered,
    missing: e.gamesMissing,
  }));

  const covered = perEmulator.reduce((sum, e) => sum + e.gamesCovered, 0);
  const missing = perEmulator.reduce((sum, e) => sum + e.gamesMissing, 0);

  return {
    totals: {
      emulators: tracked.length,
      submissions,
      frames,
      covered,
      missing,
    },
    perEmulator,
    seriesOrder,
    config,
    coverageByMonth,
    coverage,
  };
}
