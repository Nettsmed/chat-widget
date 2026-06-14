/**
 * Builds a generic revalidate POST handler. WordPress calls it (with a shared
 * secret) when content changes so the bot picks it up immediately instead of
 * waiting for the next refresh. Secret via `?secret=` or `x-revalidate-secret`.
 */
export function createRevalidateHandler(cfg: {
  secret: string | undefined;
  invalidate: () => void;
}) {
  return async function POST(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const provided = req.headers.get("x-revalidate-secret") || url.searchParams.get("secret");
    if (!cfg.secret || provided !== cfg.secret) {
      return new Response("Unauthorized", { status: 401 });
    }
    cfg.invalidate();
    return Response.json({ revalidated: true });
  };
}
