"use client";

import { useState, useTransition } from "react";
import { inviteUser, type InviteResult } from "../actions";

function LinkBox({ result, email }: { result: InviteResult; email: string }) {
  const [copied, setCopied] = useState(false);
  if (result.error) return <p className="mt-2 text-sm text-danger">{result.error}</p>;
  if (!result.link) return null;
  return (
    <div className="mt-2 rounded-lg bg-accent-soft p-3 text-sm">
      <p>
        {result.created ? `Access given to ${email}.` : `New sign-in link for ${email}.`} Send them this link. It works once, in
        any browser, for about an hour.
      </p>
      <div className="mt-2 flex gap-2">
        <input readOnly value={result.link} aria-label="Sign-in link" className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-xs" />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(result.link!);
            setCopied(true);
          }}
          className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [result, setResult] = useState<InviteResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setSentTo(email.trim());
          setResult(await inviteUser(email));
          setEmail("");
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
          aria-label="Email to invite"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button disabled={pending} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? "Creating…" : "Give access"}
        </button>
      </div>
      {result && <LinkBox result={result} email={sentTo} />}
    </form>
  );
}

/** A fresh one-time sign-in link for someone who already has access. */
export function NewLinkButton({ email }: { email: string }) {
  const [result, setResult] = useState<InviteResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await inviteUser(email)))}
        className="text-xs text-accent hover:underline disabled:opacity-60"
      >
        {pending ? "Creating…" : "New sign-in link"}
      </button>
      {result && <LinkBox result={result} email={email} />}
    </div>
  );
}
