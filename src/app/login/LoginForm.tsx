"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "../actions";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { error: initialError });

  if (state.sent) {
    return (
      <p className="mt-6 rounded-lg bg-accent-soft p-3 text-sm">
        Check your inbox for a sign-in link. Open it in this browser.
      </p>
    );
  }
  return (
    <form action={action} className="mt-6 space-y-3">
      <input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <button
        disabled={pending}
        className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}
