export type Tier = "public" | "lokallagsleder" | "staff";

export type AccessContext = {
  tier: Tier;
  /** Verified scoped id the caller may see data for. Null when anonymous. */
  scopeId: string | null;
};

/**
 * THE SEAM. Default returns anonymous public access — privileged, per-scope
 * tools are never reachable. A client can supply its own resolver to verify a
 * session (cookie/JWT) and return an elevated tier WITHOUT touching any other
 * code path. The LLM is never the access-control boundary; scope is decided here.
 */
export async function resolveAccessContext(_req: Request): Promise<AccessContext> {
  return { tier: "public", scopeId: null };
}
