import Link from "next/link";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-5 py-5">
        <Link href="/" className="focus-ring rounded-lg">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-5 pt-6 pb-16 sm:items-center sm:pt-0">
        {children}
      </main>
    </div>
  );
}
