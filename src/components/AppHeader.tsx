import Link from "next/link";
import { signOut } from "@/app/actions";
import { isAdmin } from "@/lib/access";

const LINKS = [
  { key: "feed", href: "/", label: "Injuries", adminOnly: false },
  { key: "teams", href: "/teams", label: "Teams", adminOnly: false },
  { key: "people", href: "/people", label: "People", adminOnly: true },
] as const;

export function AppHeader({ active, email }: { active: (typeof LINKS)[number]["key"]; email?: string }) {
  const admin = isAdmin(email);
  return (
    <header className="flex items-center justify-between gap-3">
      <nav className="flex items-center gap-1" aria-label="Main">
        {LINKS.filter((l) => admin || !l.adminOnly).map((l) => (
          <Link
            key={l.key}
            href={l.href}
            aria-current={l.key === active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              l.key === active ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <form action={signOut} className="flex items-center gap-3 text-sm text-muted">
        <span className="hidden md:inline">{email}</span>
        <button className="hover:text-foreground hover:underline">Sign out</button>
      </form>
    </header>
  );
}
