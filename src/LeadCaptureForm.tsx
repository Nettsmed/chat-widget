"use client";

import { useId, useState } from "react";
import type { LeadFormCopy } from "./leadForm";

export function LeadCaptureForm({
  copy,
  initialEmail,
  initialComment,
  showEmail,
  commentRequired,
  busy,
  serverError,
  flush = false,
  onSubmit,
}: {
  copy: LeadFormCopy;
  initialEmail: string;
  initialComment: string;
  showEmail: boolean;
  commentRequired: boolean;
  busy: boolean;
  serverError: string | null;
  /** Drop the top rule when the form is the whole bubble. */
  flush?: boolean;
  onSubmit: (draft: { email: string; comment: string }) => void;
}) {
  const emailId = useId();
  const commentId = useId();
  const [email, setEmail] = useState(initialEmail);
  const [comment, setComment] = useState(initialComment);
  const [error, setError] = useState<string | null>(null);
  const [hideServerError, setHideServerError] = useState(false);
  const commentMissing = commentRequired && !comment.trim();
  const emailMissing = showEmail && !email.trim();
  const shownError = error ?? (hideServerError ? null : serverError);

  return (
    <form
      data-testid="lead-capture-form"
      aria-label={copy.title}
      className={`space-y-2 ${flush ? "" : "mt-2 border-t border-current/15 pt-2"}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (showEmail && !email.trim()) {
          setError(copy.emailInvalid);
          return;
        }
        if (commentRequired && !comment.trim()) {
          setError(copy.commentMissing);
          return;
        }
        setError(null);
        onSubmit({ email: email.trim(), comment: comment.trim() });
      }}
    >
      <p className="m-0 text-[12.5px] font-medium leading-snug">{copy.title}</p>
      <p className="m-0 text-[11.5px] leading-snug opacity-70">{copy.hint}</p>
      {showEmail && (
        <label htmlFor={emailId} className="block text-[12px] font-medium">
          {copy.emailLabel}
          <input
            id={emailId}
            data-testid="lead-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={busy}
            placeholder={copy.emailPlaceholder}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
              setHideServerError(true);
            }}
            className="mt-1 block w-full rounded-[6px] border border-[var(--cw-border)] bg-[var(--cw-msg-bg)] px-2.5 py-1.5 text-[13px] font-normal text-[var(--cw-primary)] placeholder-[var(--cw-placeholder)] transition-colors duration-200 focus:border-[var(--cw-primary-hover)] focus:bg-white focus:outline-none disabled:opacity-60"
          />
        </label>
      )}
      <label htmlFor={commentId} className="block text-[12px] font-medium">
        {copy.commentLabel}
        <textarea
          id={commentId}
          data-testid="lead-comment"
          name="comment"
          required={commentRequired}
          rows={3}
          value={comment}
          disabled={busy}
          placeholder={copy.commentPlaceholder}
          onChange={(event) => {
            setComment(event.target.value);
            setError(null);
            setHideServerError(true);
          }}
          className="mt-1 block w-full resize-y rounded-[6px] border border-[var(--cw-border)] bg-[var(--cw-msg-bg)] px-2.5 py-1.5 text-[13px] font-normal leading-[1.45] text-[var(--cw-primary)] placeholder-[var(--cw-placeholder)] transition-colors duration-200 focus:border-[var(--cw-primary-hover)] focus:bg-white focus:outline-none disabled:opacity-60"
        />
      </label>
      {shownError && (
        <p role="alert" className="m-0 text-[12px] text-[var(--cw-error-text)]">
          {shownError}
        </p>
      )}
      <button
        type="submit"
        data-testid="lead-submit"
        disabled={busy || commentMissing || emailMissing}
        className="inline-flex cursor-pointer items-center rounded-[6px] bg-[var(--cw-primary)] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors duration-200 hover:bg-[var(--cw-primary-hover)] disabled:cursor-not-allowed disabled:bg-[var(--cw-disabled-send)]"
      >
        {copy.submitLabel}
      </button>
    </form>
  );
}
