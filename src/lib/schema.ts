import { z } from "zod";

export const EmulatorSchema = z.object({
  slug: z.string(),
  name: z.string(),
  console: z.string(),
  description: z.string(),
  repo_url: z.string(),
  commit_url_template: z.string(),
  accent_color: z.string(),
  icon: z.string().optional(),
  author: z.string().optional(),
  // Frames below this index are BIOS/boot animation; gained/lost screenshot
  // detection only considers frames from this index onwards.
  first_game_frame: z.number().int().nonnegative().optional(),
});
export type Emulator = z.infer<typeof EmulatorSchema>;

export const GameRefSchema = z.object({
  game_id: z.string(),
  game_title: z.string(),
});
export type GameRef = z.infer<typeof GameRefSchema>;

export const ScreenshotSchema = z.object({
  game_id: z.string(),
  frame_index: z.number().int().nonnegative(),
  r2_key: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string(),
});
export type Screenshot = z.infer<typeof ScreenshotSchema>;

// An optional per-game animated demo, stored as lossless WebP (or GIF if smaller).
// At most one per game per commit.
export const DemoSchema = z.object({
  game_id: z.string(),
  r2_key: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string(),
});
export type Demo = z.infer<typeof DemoSchema>;

export const SubmissionSchema = z.object({
  emulator: z.string(),
  commit: z.string(),
  commit_short: z.string(),
  parent: z.string(),
  branch: z.string(),
  commit_message: z.string(),
  commit_timestamp: z.string(),
  submitted_at: z.string(),
  submitted_by: z.string(),
  games: z.array(GameRefSchema),
  screenshots: z.array(ScreenshotSchema),
  // Optional: older submissions predate demos.
  demos: z.array(DemoSchema).optional(),
});
export type Submission = z.infer<typeof SubmissionSchema>;
