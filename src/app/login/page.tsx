import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold">Fantasy Basketball Assistant</h1>
        <p className="mt-1 text-sm text-muted">Sign in with a link sent to your email.</p>
        <LoginForm initialError={typeof error === "string" ? error : undefined} />
      </div>
    </main>
  );
}
