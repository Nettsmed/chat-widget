"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SmartTable } from "./SmartTable";

type Props = {
  text: string;
  tone: "bot" | "user";
  linkTarget?: "_blank" | "_top";
  /** Host of the parent page (from ?ctx). Same-host links navigate the parent
   *  (_top) so the chat follows along and the conversation continues there. */
  parentHost?: string;
};

/** Same-site links → _top (parent navigates, chat stays open). External → fallback. */
function resolveLink(
  href: string | undefined,
  parentHost: string | undefined,
  fallback: "_blank" | "_top",
): { target: "_blank" | "_top"; rel: string } {
  if (href && parentHost) {
    try {
      const u = new URL(href, `https://${parentHost}`);
      if (u.host === parentHost) return { target: "_top", rel: "noopener" };
    } catch {
      // fall through to fallback
    }
  }
  return { target: fallback, rel: fallback === "_blank" ? "noopener noreferrer" : "noopener" };
}

export function MessageText({ text, tone, linkTarget = "_blank", parentHost }: Props) {
  const linkColor = tone === "user" ? "text-white" : "text-[var(--cw-primary-hover)]";
  const strongColor = tone === "user" ? "text-white" : "text-[var(--cw-primary)]";

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="m-0 leading-[1.55] [&:not(:first-child)]:mt-2">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className={`font-semibold ${strongColor}`}>{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => (
          <ul className="list-disc pl-4 my-2 space-y-1 marker:text-current/60">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-4 my-2 space-y-1 marker:text-current/60">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-[1.5]">{children}</li>,
        a: ({ children, href }) => {
          const { target, rel } = resolveLink(href, parentHost, linkTarget);
          return (
            <a
              href={href}
              target={target}
              rel={rel}
              className={`underline underline-offset-2 ${linkColor} hover:opacity-80`}
            >
              {children}
            </a>
          );
        },
        h1: ({ children }) => (
          <strong className={`block text-[14px] font-semibold mt-3 mb-1 ${strongColor}`}>
            {children}
          </strong>
        ),
        h2: ({ children }) => (
          <strong className={`block text-[14px] font-semibold mt-3 mb-1 ${strongColor}`}>
            {children}
          </strong>
        ),
        h3: ({ children }) => (
          <strong className={`block text-[13px] font-semibold mt-3 mb-1 ${strongColor}`}>
            {children}
          </strong>
        ),
        code: ({ children }) => (
          <code className="bg-black/5 px-1 py-0.5 rounded text-[12px] font-mono">
            {children}
          </code>
        ),
        hr: () => <hr className="my-3 border-current/15" />,
        table: ({ node }) => <SmartTable node={node} tone={tone} />,
      }}
    >
      {text}
    </Markdown>
  );
}
