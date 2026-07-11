"use client";

import { AreaChart } from "../dither-kit/area-chart";
import { Area } from "../dither-kit/area";
import { BarChart } from "../dither-kit/bar-chart";
import { Bar } from "../dither-kit/bar";
import { Grid } from "../dither-kit/grid";
import { XAxis } from "../dither-kit/x-axis";
import { YAxis } from "../dither-kit/y-axis";
import { Tooltip } from "../dither-kit/tooltip";
import { PALETTE, rgb } from "../dither-kit/palette";
import type { DitherColor, StatsOverview } from "@/lib/stats";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// "2026-07" -> "Jul '26"
function formatMonth(value: unknown): string {
  const [year, month] = String(value).split("-");
  const label = MONTHS[Number(month) - 1] ?? month;

  return `${label} '${year.slice(2)}`;
}

function full(value: number): string {
  return value.toLocaleString();
}

interface LegendItem {
  label: string;
  color: DitherColor;
}

// Rendered in normal flow above the chart, so long labels wrap freely without
// overlapping the plot the way dither-kit's own absolutely-positioned legend
// does. Colours are taken straight from dither-kit's palette to stay in sync.
function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-1.5 font-mono text-[11px] text-neutral-600 dark:text-neutral-400"
        >
          <span
            className="size-2 shrink-0 rounded-[1px]"
            style={{ backgroundColor: rgb(PALETTE[item.color].fill) }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

interface Props {
  overview: StatsOverview;
}

export default function StatsCharts({ overview }: Props) {
  const { config, seriesOrder, coverageByMonth, coverage } = overview;

  const coverageLegend: LegendItem[] = seriesOrder.map((slug) => ({
    label: config[slug].label,
    color: config[slug].color,
  }));

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Games covered over time
        </h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Games with a screenshot in each emulator, by month. Click a band to isolate it.
        </p>

        <ChartLegend items={coverageLegend} />

        <div className="mt-4 h-80">
          <AreaChart
            data={coverageByMonth}
            config={config}
            stackType="stacked"
            className="h-full w-full"
          >
            <Grid />
            <XAxis dataKey="month" tickFormatter={formatMonth} />
            <YAxis tickFormatter={full} />
            {seriesOrder.map((slug) => (
              <Area key={slug} dataKey={slug} variant="gradient" isClickable />
            ))}
            <Tooltip labelKey="month" valueFormatter={full} />
          </AreaChart>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Games covered vs missing
        </h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          For each emulator's latest commit, how many games have a screenshot and how many are still missing one.
        </p>

        <ChartLegend
          items={[
            { label: "Has a screenshot", color: "blue" },
            { label: "No screenshot", color: "grey" },
          ]}
        />

        <div className="mt-4 h-72">
          <BarChart
            data={coverage}
            config={{
              covered: { label: "Has a screenshot", color: "blue" },
              missing: { label: "No screenshot", color: "grey" },
            }}
            stackType="stacked"
            className="h-full w-full"
          >
            <Grid />
            <XAxis dataKey="short" />
            <YAxis tickFormatter={full} />
            <Bar dataKey="covered" variant="gradient" />
            <Bar dataKey="missing" variant="gradient" />
            <Tooltip labelKey="emulator" valueFormatter={full} />
          </BarChart>
        </div>
      </section>
    </div>
  );
}
