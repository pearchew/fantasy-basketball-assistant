import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { isAdmin } from "@/lib/access";
import { ago } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { InviteForm, NewLinkButton } from "./InviteControls";

// Admin only: who has access, and one-time sign-in links to send people.
export default async function PeoplePage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const email = auth?.claims?.email as string | undefined;
  if (!isAdmin(email)) notFound();

  const { data, error } = await createAdminClient().auth.admin.listUsers({ perPage: 200 });
  const users = (data?.users ?? []).sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <AppHeader active="people" email={email} />
      <main className="mt-6 space-y-4">
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <h2 className="text-lg font-semibold">Give someone access</h2>
            <p className="text-sm text-muted">
              Creates their account and a one-time sign-in link for you to send them. No email is sent. They get their own teams
              and watchlist; the injury feed, next-up calls and stats are shared.
            </p>
          </div>
          <InviteForm />
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-semibold">
            People with access <span className="font-normal text-muted">{users.length}</span>
          </h2>
          {error && <p className="mt-2 text-sm text-danger">Couldn&apos;t load accounts: {error.message}</p>}
          <ul className="mt-2 divide-y divide-border">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                <div>
                  <span className="font-medium">{u.email}</span>
                  {isAdmin(u.email) && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">Admin</span>}
                  <p className="text-xs text-muted">
                    {u.last_sign_in_at ? `Last signed in ${ago(u.last_sign_in_at)}` : "Hasn't signed in yet"} · added {ago(u.created_at)}
                  </p>
                </div>
                {u.email && <NewLinkButton email={u.email} />}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            To remove someone, delete their user in Supabase (Authentication → Users). That also deletes their teams and watchlist.
          </p>
        </section>
      </main>
    </div>
  );
}
