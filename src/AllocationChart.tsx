import type { AllocationShare } from "./timesheet";
import type { DisplayFormat, SourceError } from "./types";
import { formatDuration } from "./time";

/** Fixed colours of the default categories. */
const CATEGORY_COLORS: Record<string, string> = {
  implementation: "#2182a0",
  sme: "#01b8aa",
  academy: "#f2c80f",
  support: "#018a80"
};
const PALETTE = ["#8c6bb1", "#d9625b", "#5b8dd9", "#e9a23b", "#7aa35c", "#c27ba0", "#3e7e9a", "#a66f3b"];
const OTHER = "#a0a8b3";

const percentFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatPercent = (value: number) => `${percentFormat.format(value)}%`;

interface Item extends AllocationShare {
  color: string;
}

function ShareLegend({ label, items, format }: { label: string; items: Item[]; format: DisplayFormat }) {
  return (
    <ul className="shareLegend" aria-label={label}>
      {items.map((item) => {
        const tip = `${item.name}: ${formatPercent(item.percent)} · ${formatDuration(item.seconds, format) || "0"}`;
        return (
          <li key={item.name} data-tip={tip} aria-label={tip}>
            <span className="swatch" style={{ background: item.color }} />
            {item.name} <b>{formatPercent(item.percent)}</b>
          </li>
        );
      })}
    </ul>
  );
}

interface Props {
  allocation: AllocationShare[];
  /** The categories' JQL searches are still running (they load alongside the grid). */
  allocationLoading?: boolean;
  /** Categories whose JQL failed on a source; they matched nothing there. */
  allocationErrors?: SourceError[];
  clients: AllocationShare[];
  format: DisplayFormat;
  /** Category names in Settings order: categories without a fixed colour keep theirs from month to month. */
  categories: string[];
}

/** Worklogs allocation by category and the top clients, as two colour-keyed lines under the table. */
export function AllocationChart({ allocation, allocationLoading = false, allocationErrors = [], clients, format, categories }: Props) {
  if (!allocation.length && !clients.length && !allocationLoading) return null;
  const categoryColor = (name: string) => {
    if (!categories.includes(name)) return OTHER;
    return CATEGORY_COLORS[name.trim().toLowerCase()] || PALETTE[categories.indexOf(name) % PALETTE.length];
  };
  return (
    <section className="allocation" aria-label="Worklogs allocation">
      {allocationLoading ? (
        <div className="shareLine">
          <span className="shareCaption">Allocation</span>
          <span className="shareLoading" role="status">
            Loading…
          </span>
        </div>
      ) : (
        allocation.length > 0 && (
          <div className="shareLine">
            <span
              className={allocationErrors.length ? "shareCaption warn" : "shareCaption"}
              data-tip={
                allocationErrors.length
                  ? `Not checked (counted as Other):\n${allocationErrors.map((error) => `${error.sourceName}: ${error.message}`).join("\n")}`
                  : undefined
              }
            >
              Allocation
            </span>
            <ShareLegend label="Allocation" format={format} items={allocation.map((share) => ({ ...share, color: categoryColor(share.name) }))} />
          </div>
        )
      )}
      {clients.length > 0 && (
        <div className="shareLine">
          <span className="shareCaption">Top clients</span>
          <ShareLegend
            label="Top clients"
            format={format}
            items={clients.map((share, index) => ({ ...share, color: PALETTE[index % PALETTE.length] }))}
          />
        </div>
      )}
    </section>
  );
}
