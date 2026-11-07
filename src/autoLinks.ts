/** Remark plugin: turns pattern matches in plain text into links (no extra deps). */

export type AutoLink = { pattern: RegExp; href: (match: string) => string };

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
};

const SKIP = new Set(["link", "linkReference", "inlineCode", "code", "definition", "html"]);

function globalCopy(re: RegExp): RegExp {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return new RegExp(re.source, flags);
}

type Hit = { start: number; end: number; url: string };

function findHits(text: string, rules: { re: RegExp; href: AutoLink["href"] }[]): Hit[] {
  const hits: Hit[] = [];
  for (const { re, href } of rules) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0] === "") {
        re.lastIndex++;
        continue;
      }
      hits.push({ start: m.index, end: m.index + m[0].length, url: href(m[0]) });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Hit[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue; // overlaps an earlier match
    kept.push(h);
    cursor = h.end;
  }
  return kept;
}

function splitText(node: MdNode, rules: Parameters<typeof findHits>[1]): MdNode[] | null {
  const text = node.value ?? "";
  const hits = findHits(text, rules);
  if (hits.length === 0) return null;
  const out: MdNode[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start > pos) out.push({ type: "text", value: text.slice(pos, h.start) });
    out.push({
      type: "link",
      url: h.url,
      children: [{ type: "text", value: text.slice(h.start, h.end) }],
    });
    pos = h.end;
  }
  if (pos < text.length) out.push({ type: "text", value: text.slice(pos) });
  return out;
}

function walk(node: MdNode, rules: Parameters<typeof findHits>[1]): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (SKIP.has(child.type)) {
      next.push(child);
    } else if (child.type === "text") {
      next.push(...(splitText(child, rules) ?? [child]));
    } else {
      walk(child, rules);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkAutoLinks(links: readonly AutoLink[]) {
  // Own g-flag copies: callers may pass patterns without `g`, and `lastIndex`
  // must never leak between renders.
  const rules = links.map((l) => ({ re: globalCopy(l.pattern), href: l.href }));
  return () => (tree: MdNode) => {
    if (rules.length > 0) walk(tree, rules);
  };
}
