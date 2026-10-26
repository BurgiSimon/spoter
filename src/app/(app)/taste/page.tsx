import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BarList, Columns, Diverging } from "@/components/charts";
import { TasteControls } from "@/components/taste-controls";
import { PageHeader, PageSkeleton, Panel } from "@/components/ui";
import { requireUser } from "@/lib/auth/current";
import { getTaste } from "@/lib/taste";

export const metadata: Metadata = { title: "Your taste" };

export default function TastePage() {
  return (
    <>
      <PageHeader
        title="Your taste"
        subtitle="What Spoter has learned from your library and from every swipe, duel and ranking."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

async function Content() {
  const user = await requireUser();
  const taste = await getTaste(user.id);
  const signals =
    (taste.feedback.swipe ?? 0) + (taste.feedback.duel ?? 0) + (taste.feedback.rank ?? 0);

  if (!taste.hasProfile) {
    return (
      <Panel className="text-center">
        <p className="text-muted text-sm">Your taste profile is built after your first import.</p>
        <Link
          href="/import"
          className="text-brand mt-2 inline-block text-sm font-semibold hover:underline"
        >
          Import your music
        </Link>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Songs analysed" value={compact.format(taste.stats?.tracks ?? 0)} />
        <Tile label="Hours listened" value={compact.format(taste.stats?.hours ?? 0)} />
        <Tile label="Signals you gave" value={compact.format(signals)} />
        <Tile label="Songs matched" value={compact.format(taste.likes)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <h2 className="font-semibold">Your sound</h2>
          <p className="text-muted mb-5 text-xs">
            Most characteristic tags in your library, weighted by how distinctive they are.
          </p>
          {taste.tags.length ? (
            <BarList
              caption="Most characteristic tags"
              items={taste.tags.map((t) => ({
                label: t.tag,
                value: t.share,
                hint: `${Math.round(t.share * 100)}`,
              }))}
            />
          ) : (
            <p className="text-muted text-sm">Tags appear once Spoter has analysed your artists.</p>
          )}
        </Panel>
        <Panel>
          <h2 className="font-semibold">Your eras</h2>
          <p className="text-muted mb-5 text-xs">Share of your listening by release decade.</p>
          {taste.decades.length ? (
            <Columns
              caption="Listening by decade"
              items={taste.decades.map((d) => ({ label: `${d.decade}s`.slice(2), value: d.share }))}
            />
          ) : (
            <p className="text-muted text-sm">Release years are still being looked up.</p>
          )}
        </Panel>
      </div>

      <Panel>
        <h2 className="font-semibold">Learned from your feedback</h2>
        <p className="text-muted mb-5 text-xs">
          Tags your swipes and duels pushed up or down, on top of what your library already says.{" "}
          {taste.novelty > 0.15
            ? "You tend to enjoy artists you haven't heard before."
            : taste.novelty < -0.15
              ? "You tend to prefer artists you already know."
              : ""}
        </p>
        {taste.leaningIn.length + taste.leaningOut.length ? (
          <Diverging
            caption="Learned tag preferences"
            items={[...taste.leaningIn, ...[...taste.leaningOut].reverse()].map((l) => ({
              label: l.tag,
              value: l.mean,
            }))}
          />
        ) : (
          <p className="text-muted text-sm">
            Nothing yet. Swipe or duel a few songs and the strongest leanings show up here.
          </p>
        )}
      </Panel>

      {taste.artists.length > 0 && (
        <Panel>
          <h2 className="mb-4 font-semibold">Your core artists</h2>
          <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {taste.artists.map((a) => (
              <li key={a.id} className="text-center">
                {a.imageUrl ? (
                  <img
                    src={a.imageUrl}
                    alt=""
                    className="bg-surface-3 mx-auto aspect-square w-full rounded-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="bg-brand-gradient mx-auto aspect-square w-full rounded-full"
                    aria-hidden
                  />
                )}
                <p className="mt-2 truncate text-sm">{a.name}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <h2 className="mb-1 font-semibold">Tune your recommendations</h2>
        <p className="text-muted mb-5 text-xs">
          These knobs shift the ranking without erasing what Spoter has learned.
        </p>
        <TasteControls initial={taste.settings} blocked={taste.blocked} />
      </Panel>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line bg-surface rounded-2xl border p-4">
      <p className="text-muted text-xs">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
