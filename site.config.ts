export const siteConfig = {
  defaultEmulator: "gecko",
  screenshotsBaseUrl: "https://screenshots.layle.dev",
} as const;

export type SiteConfig = typeof siteConfig;
