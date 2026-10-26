import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { env, spotifyEnabled } from "@/lib/env";
import { AuthForm } from "./auth-form";

export async function AuthPage({
  mode,
  searchParams,
}: {
  mode: "login" | "register";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  if (user) redirect("/discover");
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <AuthForm
      mode={mode}
      error={first(params.error)}
      next={first(params.next)}
      spotify={spotifyEnabled()}
      registrationOpen={env().ALLOW_REGISTRATION}
    />
  );
}
