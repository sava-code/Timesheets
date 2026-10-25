import type { AllocationShare } from "./timesheet";
import type { DisplayFormat } from "./types";
import { formatDuration } from "./time";

const COLORS = ["#3e7e9a", "#52b6a8", "#e9a23b", "#8c6bb1", "#d9625b", "#5b8dd9", "#7aa35c", "#c27ba0"];
const OTHER = "#a0a8b3";

const percentFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatPercent = (value: number) => `${percentFormat.format(value)}%`;

interface Props {
  shares: AllocationShare[];
  format: DisplayFormat;
  /** Category names in Settings order: each keeps its colour from month to month. */
  categories: string[];
}

/** One horizontal bar split by category, each part labelled with its name and share. */
export function AllocationChart({ shares, format, categories }: Props) {
  if (!shares.length) return null;
  const parts = shares.map((share) => ({
    ...share,
    color: categories.includes(share.name) ? COLORS[categories.indexOf(share.name) % COLORS.length] : OTHER,
    tip: `${share.name}: ${formatPercent(share.percent)} · ${formatDuration(share.seconds, format) || "0"}`
  }));
  return (
    <section className="allocation" aria-label="Worklogs allocation">
      <h3 className="allocationTitle">Worklogs allocation</h3>
      <div className="allocationBar" role="list">
        {parts.map((part) => (
          <div
            key={part.name}
            role="listitem"
            className="allocationPart"
            style={{ flexGrow: part.seconds, flexBasis: 0, background: part.color }}
            data-tip={part.tip}
            aria-label={part.tip}
          >
            {part.percent >= 6 && (
              <span className="allocationLabel">
                {part.name} {formatPercent(part.percent)}
              </span>
            )}
          </div>
        ))}
      </div>
      <ul className="allocationLegend">
        {parts.map((part) => (
          <li key={part.name}>
            <span className="swatch" style={{ background: part.color }} />
            {part.name} <b>{formatPercent(part.percent)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
