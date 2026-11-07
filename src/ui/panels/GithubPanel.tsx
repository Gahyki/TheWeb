import { useMemo } from "react";
import { useGithubSnapshot } from "../../hooks/useGithubSnapshot";
import type { ContributionCalendar } from "../github";
import { FALLBACK_REPOS } from "../github";
import { Eyebrow, Reveal } from "../Reveal";

const WEEKS_SHOWN = 26;
/** Cap matches the server's; also keeps Reveal indices within MAX_STAGGER_INDEX. */
const REPOS_SHOWN = 4;

/**
 * Contribution-calendar dot field. With live data (server has a
 * GITHUB_TOKEN) each cell is a real day; otherwise it renders a
 * deterministic decorative pattern in the same visual language.
 */
function DotGrid({ contributions }: { contributions: ContributionCalendar | null }) {
  const { cells, shownTotal } = useMemo(() => {
    if (contributions) {
      const weeks = contributions.weeks.slice(-WEEKS_SHOWN);
      const flat: number[] = [];
      for (const week of weeks) {
        for (let day = 0; day < 7; day += 1) {
          flat.push(week[day] ?? 0);
        }
      }
      const max = Math.max(1, ...flat);
      return {
        cells: flat.map((count) => (count === 0 ? 0.05 : 0.14 + 0.5 * (count / max))),
        shownTotal: flat.reduce((sum, count) => sum + count, 0),
      };
    }
    const decorative: number[] = [];
    for (let i = 0; i < 7 * WEEKS_SHOWN; i += 1) {
      const noise = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      decorative.push(0.05 + noise * 0.45);
    }
    return { cells: decorative, shownTotal: 0 };
  }, [contributions]);

  return (
    <div
      {...(contributions
        ? {
            role: "img",
            "aria-label": `${shownTotal} contributions in the last ${WEEKS_SHOWN} weeks`,
          }
        : { "aria-hidden": true })}
      className="grid w-full max-w-[257px] grid-flow-col grid-rows-7 gap-[3px]"
      style={{ gridAutoColumns: "minmax(0, 1fr)" }}
    >
      {cells.map((alpha, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size calendar grid
          key={index}
          className="aspect-square rounded-[1px]"
          style={{ backgroundColor: `rgba(191, 234, 255, ${alpha})` }}
        />
      ))}
    </div>
  );
}

export function GithubPanel() {
  const { snapshot, failed } = useGithubSnapshot();

  const repos = (snapshot && snapshot.repos.length > 0 ? snapshot.repos : FALLBACK_REPOS).slice(
    0,
    REPOS_SHOWN,
  );
  const contributions = snapshot?.contributions ?? null;

  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <Reveal i={0}>
        <Eyebrow>GitHub</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <h2 className="text-3xl font-extralight tracking-wide text-white">Open source</h2>
      </Reveal>
      <Reveal i={2}>
        <DotGrid contributions={contributions} />
      </Reveal>
      <div className="flex flex-col gap-3">
        {repos.map((repo, index) => (
          <Reveal i={3 + index} key={repo.name}>
            <a
              href={repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block border border-white/10 bg-black/40 px-5 py-3 backdrop-blur-sm transition-colors duration-300 hover:border-white/25 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-white">
                  {repo.name}
                </span>
                <span className="text-[10px] text-cyan-100/50">
                  {repo.language ?? ""}
                  {repo.stars > 0 ? ` · ★ ${repo.stars}` : ""}
                </span>
              </div>
              {repo.description && (
                <p className="mt-1 text-xs font-light text-white/50">{repo.description}</p>
              )}
            </a>
          </Reveal>
        ))}
      </div>
      <Reveal i={7}>
        <a
          href="https://github.com/Gahyki"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/60 transition-colors hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
        >
          github.com/Gahyki →{failed ? " (live data unavailable)" : ""}
        </a>
      </Reveal>
    </div>
  );
}
