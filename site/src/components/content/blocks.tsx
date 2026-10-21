import type { ReactNode } from "react";

export interface Source {
  label: string;
  url: string;
}

/** Date the competitor pages were read. Update together with the content. */
export const SOURCES_CHECKED_ON = "21/10/2026";

/** Wide table that scrolls sideways on small screens. */
export function ComparisonTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="not-prose my-8 -mx-6 md:mx-0 overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm bg-white md:rounded-2xl">
        <caption className="text-left text-xs text-mid px-6 md:px-0 pb-3">{caption}</caption>
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th
                key={i}
                scope="col"
                className="text-left align-bottom font-medium text-forest border-b border-sage/20 px-3 py-3 first:pl-6 md:first:pl-4"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-sage/10 last:border-0">
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row" className="text-left align-top font-medium text-forest px-3 py-3 pl-6 md:pl-4">
                    {cell}
                  </th>
                ) : (
                  <td key={c} className="align-top text-charcoal/80 px-3 py-3">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SourceList({
  sources,
  intro = `Páginas oficiais consultadas em ${SOURCES_CHECKED_ON}. Preços e recursos mudam: confira sempre no site de cada empresa antes de decidir.`,
}: {
  sources: Source[];
  intro?: string;
}) {
  return (
    <section aria-labelledby="fontes" className="mt-12">
      <h2 id="fontes">Fontes</h2>
      <p>{intro}</p>
      <ul>
        {sources.filter((s, i) => sources.findIndex((o) => o.url === s.url) === i).map((source) => (
          <li key={source.url}>
            {source.label}:{" "}
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.url.replace(/^https?:\/\//, "")}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Callout that states FloraClin's bias up front. */
export function BiasNote({ children }: { children: ReactNode }) {
  return (
    <aside className="not-prose my-8 rounded-2xl border-l-4 border-warm-accent bg-petal/60 px-6 py-5 text-charcoal/85 leading-relaxed">
      {children}
    </aside>
  );
}

const HEAD_TO_HEAD_ROWS: { label: string; key: "focus" | "price" | "trial" | "prontuario" | "facialMap" | "beforeAfter" | "lgpd" }[] = [
  { label: "Foco", key: "focus" },
  { label: "Preço", key: "price" },
  { label: "Teste grátis", key: "trial" },
  { label: "Prontuário", key: "prontuario" },
  { label: "Mapa facial", key: "facialMap" },
  { label: "Antes e depois", key: "beforeAfter" },
  { label: "LGPD", key: "lgpd" },
];

type Facts = Record<(typeof HEAD_TO_HEAD_ROWS)[number]["key"] | "name", string>;

/** Two systems side by side, one row per compared point. */
export function HeadToHead({ a, b }: { a: Facts; b: Facts }) {
  return (
    <ComparisonTable
      caption={`Dados das páginas oficiais, consultadas em ${SOURCES_CHECKED_ON}.`}
      head={["", a.name, b.name]}
      rows={HEAD_TO_HEAD_ROWS.map((r) => [r.label, a[r.key], b[r.key]])}
    />
  );
}
