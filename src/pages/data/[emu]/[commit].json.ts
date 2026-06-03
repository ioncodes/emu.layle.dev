import type { APIRoute } from "astro";
import { getCommits, getEmulators, toCommitData } from "@/lib/meta";

export function getStaticPaths() {
  const paths: { params: { emu: string; commit: string } }[] = [];
  
  for (const emu of getEmulators()) {
    for (const sub of getCommits(emu.slug)) {
      paths.push({ params: { emu: emu.slug, commit: sub.commit_short } });
    }
  }

  return paths;
}

export const GET: APIRoute = ({ params }) => {
  const data = toCommitData(params.emu!, params.commit!);
  if (!data) return new Response("not found", { status: 404 });

  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
};
