export type ErrorCode =
  | "not_authenticated"
  | "session_expired"
  | "invalid_state"
  | "permission_required"
  | "invalid_input"
  | "invalid_record"
  | "bean_not_found"
  | "brew_not_found"
  | "record_not_found"
  | "roaster_required"
  | "roaster_not_found"
  | "roaster_not_owned"
  | "record_not_owned"
  | "bean_not_owned"
  | "ambiguous_selection"
  | "pds_unavailable"
  | "conflict"
  | "internal_error";
export class ToolFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
export function failureResult(e: unknown) {
  const x =
    e instanceof ToolFailure
      ? e
      : new ToolFailure("internal_error", "The Arabica operation failed.");
  return {
    isError: true,
    content: [{ type: "text" as const, text: x.message }],
    structuredContent: {
      ok: false,
      error: { code: x.code, message: x.message, retryable: x.retryable },
    },
  };
}
export function successResult(data: Record<string, unknown>, summary: string) {
  return {
    isError: false,
    content: [{ type: "text" as const, text: summary }],
    structuredContent: { ok: true, ...data },
  };
}
export function mapError(e: unknown): ToolFailure {
  if (e instanceof ToolFailure) return e;
  if (e instanceof Error && e.message === "not_authenticated")
    return new ToolFailure(
      "not_authenticated",
      "No Arabica session is available. Run `arabica-mcp login` first.",
    );
  const kind = (e as { kind?: unknown } | null | undefined)?.kind;
  if (kind === "permission")
    return new ToolFailure(
      "permission_required",
      "The session is not permitted to write these Arabica records.",
    );
  if (kind === "not_found")
    return new ToolFailure(
      "record_not_found",
      "The requested Arabica record was not found.",
    );
  if (kind === "conflict")
    return new ToolFailure(
      "conflict",
      "The record changed while you were editing it; re-read it and retry.",
      true,
    );
  if (kind === "unavailable")
    return new ToolFailure(
      "pds_unavailable",
      "The PDS is unavailable. Try again later.",
      true,
    );
  return new ToolFailure("internal_error", "The Arabica operation failed.");
}
