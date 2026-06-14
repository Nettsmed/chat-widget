"use client";

/**
 * Renders GFM markdown tables as a polished, compact table.
 * For numeric value columns (every body cell is a number, and it is not the
 * leftmost/label column) we draw a subtle proportional data-bar under each
 * value — turning a flat number series into an at-a-glance "mini graph".
 *
 * Brand colors come from --cw-* CSS variables set on the widget root, so this
 * component is tenant-agnostic.
 */

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
};

function textOf(node?: HastNode): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function rowsOf(table: HastNode, tag: "thead" | "tbody"): string[][] {
  const section = (table.children ?? []).find((c) => c.tagName === tag);
  if (!section) return [];
  return (section.children ?? [])
    .filter((c) => c.tagName === "tr")
    .map((tr) =>
      (tr.children ?? [])
        .filter((c) => c.tagName === "th" || c.tagName === "td")
        .map((cell) => textOf(cell).trim()),
    );
}

/** Parse a Norwegian-formatted integer ("1 837", "1 030", "924"). \s covers nbsp. */
function parseNum(s: string): number | null {
  const cleaned = s.replace(/\s/g, "");
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

export function SmartTable({
  node,
  tone,
}: {
  node?: unknown;
  tone: "bot" | "user";
}) {
  const table = node as HastNode | undefined;
  if (!table) return null;

  const header = rowsOf(table, "thead")[0] ?? [];
  const body = rowsOf(table, "tbody");
  const cols = Math.max(header.length, ...body.map((r) => r.length), 0);

  const colMax: (number | null)[] = [];
  for (let c = 0; c < cols; c++) {
    if (c === 0) {
      colMax.push(null);
      continue;
    }
    const nums = body.map((r) => parseNum(r[c] ?? ""));
    const allNumeric = nums.length > 0 && nums.every((n) => n !== null);
    colMax.push(allNumeric ? Math.max(...(nums as number[]), 1) : null);
  }

  const isUser = tone === "user";
  const barColor = isUser ? "rgba(255,255,255,0.55)" : "var(--cw-accent)";
  const headBg = isUser ? "bg-white/10" : "bg-[var(--cw-primary)]/[0.06]";
  const headText = isUser ? "text-white/80" : "text-[var(--cw-primary)]";
  const borderCol = isUser ? "border-white/15" : "border-[var(--cw-border)]";
  const cellText = isUser ? "text-white" : "text-[var(--cw-primary)]";

  return (
    <div className="my-2 overflow-x-auto -mx-0.5 px-0.5">
      <table className={`w-full border-collapse text-[12.5px] ${cellText}`}>
        {header.length > 0 && (
          <thead>
            <tr className={headBg}>
              {header.map((h, c) => (
                <th
                  key={c}
                  className={`text-left font-semibold tracking-[0.01em] uppercase text-[10.5px] px-2.5 py-1.5 ${headText} ${
                    c === 0 ? "rounded-l-[6px]" : ""
                  } ${c === header.length - 1 ? "rounded-r-[6px]" : ""} ${
                    colMax[c] !== null ? "text-right" : ""
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className={`border-b ${borderCol} last:border-0`}>
              {Array.from({ length: cols }).map((_, c) => {
                const raw = row[c] ?? "";
                const max = colMax[c];
                if (max !== null) {
                  const v = parseNum(raw) ?? 0;
                  const pct = Math.max(2, Math.round((v / max) * 100));
                  return (
                    <td key={c} className="px-2.5 py-1.5 align-bottom">
                      <div className="flex flex-col items-end gap-1">
                        <span className="font-semibold tabular-nums leading-none">
                          {raw}
                        </span>
                        <span className="block w-full h-[3px] rounded-full bg-current/10 overflow-hidden">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: pct + "%", background: barColor }}
                          />
                        </span>
                      </div>
                    </td>
                  );
                }
                return (
                  <td key={c} className="px-2.5 py-1.5 align-middle leading-[1.4]">
                    {raw}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
