/**
 * Small, dependency-free charts. Specs follow the project's dataviz rules:
 * thin bars (≤ 24px) with 4px rounded data ends, hairline baselines, values in text
 * tokens, a hover/focus tooltip per mark, and a table view for every chart.
 */

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Tooltip({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="tooltip"
      className="bg-surface-3 text-ink pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 rounded-lg px-2.5 py-1 text-xs whitespace-nowrap opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}

function TableView({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: [string, string];
  rows: [string, string][];
}) {
  return (
    <details className="text-muted mt-3 text-xs">
      <summary className="focus-ring hover:text-ink w-fit cursor-pointer rounded">
        View as table
      </summary>
      <table className="mt-2 w-full max-w-sm text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-line border-b">
            <th className="py-1 font-medium">{head[0]}</th>
            <th className="py-1 text-right font-medium">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-line/50 border-b">
              <td className="text-ink-2 py-1 capitalize">{a}</td>
              <td className="text-ink-2 py-1 text-right tabular-nums">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Horizontal bars for one series (relative weight, 0..1). */
export function BarList({
  items,
  caption,
}: {
  items: { label: string; value: number; hint: string }[];
  caption: string;
}) {
  return (
    <figure>
      <ul className="space-y-2" aria-label={caption}>
        {items.map((item, i) => (
          <li
            key={item.label}
            className="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[10rem_1fr]"
          >
            <span className="text-ink-2 truncate text-sm capitalize">{item.label}</span>
            <span
              className="group relative flex items-center gap-2 outline-none"
              tabIndex={0}
              aria-label={`${item.label}: ${item.hint}`}
            >
              <span
                className="bg-viz-1 block h-3.5 rounded-r-[4px]"
                style={{ width: `${Math.max(item.value * 85, 1.5)}%` }}
              />
              {i === 0 && <span className="text-muted text-xs tabular-nums">{item.hint}</span>}
              <Tooltip>
                <span className="capitalize">{item.label}</span> · {item.hint}
              </Tooltip>
            </span>
          </li>
        ))}
      </ul>
      <TableView
        caption={caption}
        head={["Tag", "Relative weight"]}
        rows={items.map((i) => [i.label, i.hint])}
      />
    </figure>
  );
}

/** Vertical columns over ordered categories (decades). */
export function Columns({
  items,
  caption,
}: {
  items: { label: string; value: number }[];
  caption: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 0.0001);
  const peak = items.findIndex((i) => i.value === max);
  return (
    <figure>
      <div
        className="border-viz-grid flex h-44 items-end gap-2 border-b sm:gap-3"
        role="list"
        aria-label={caption}
      >
        {items.map((item, i) => (
          <div
            key={item.label}
            role="listitem"
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
          >
            {i === peak && (
              <span className="text-muted mb-1 text-xs tabular-nums">{pct(item.value)}</span>
            )}
            <span
              className="group relative flex w-full max-w-6 outline-none"
              tabIndex={0}
              aria-label={`${item.label}: ${pct(item.value)} of your listening`}
              style={{ height: `${Math.max((item.value / max) * 80, 2)}%` }}
            >
              <span className="bg-viz-1 block h-full w-full rounded-t-[4px]" />
              <Tooltip>
                {item.label} · {pct(item.value)}
              </Tooltip>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 sm:gap-3" aria-hidden>
        {items.map((item) => (
          <span
            key={item.label}
            className="text-muted min-w-0 flex-1 text-center text-[11px] tabular-nums"
          >
            {item.label}
          </span>
        ))}
      </div>
      <TableView
        caption={caption}
        head={["Decade", "Share of listening"]}
        rows={items.map((i) => [i.label, pct(i.value)])}
      />
    </figure>
  );
}

/** Diverging bars around zero: learned leanings toward (+) or away from (−) a tag. */
export function Diverging({
  items,
  caption,
}: {
  items: { label: string; value: number }[];
  caption: string;
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 0.0001);
  return (
    <figure>
      <div className="text-muted mb-3 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="bg-viz-pos inline-block size-2.5 rounded-sm" aria-hidden /> Leaning
          toward
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-viz-neg inline-block size-2.5 rounded-sm" aria-hidden /> Leaning away
        </span>
      </div>
      <ul className="space-y-2" aria-label={caption}>
        {items.map((item) => {
          const w = `${(Math.abs(item.value) / max) * 46}%`;
          const positive = item.value > 0;
          const hint = `${positive ? "+" : "−"}${Math.abs(item.value).toFixed(2)}`;
          return (
            <li
              key={item.label}
              className="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[10rem_1fr]"
            >
              <span className="text-ink-2 truncate text-sm capitalize">{item.label}</span>
              <span
                className="group relative flex h-3.5 items-center outline-none"
                tabIndex={0}
                aria-label={`${item.label}: ${hint}`}
              >
                <span className="bg-viz-mid absolute inset-y-[-4px] left-1/2 w-px" aria-hidden />
                <span
                  className={`absolute h-3.5 ${positive ? "bg-viz-pos left-1/2 rounded-r-[4px]" : "bg-viz-neg right-1/2 rounded-l-[4px]"}`}
                  style={{ width: w }}
                />
                <Tooltip>
                  <span className="capitalize">{item.label}</span> · {hint}
                </Tooltip>
              </span>
            </li>
          );
        })}
      </ul>
      <TableView
        caption={caption}
        head={["Tag", "Learned weight"]}
        rows={items.map((i) => [
          i.label,
          `${i.value > 0 ? "+" : "−"}${Math.abs(i.value).toFixed(2)}`,
        ])}
      />
    </figure>
  );
}
