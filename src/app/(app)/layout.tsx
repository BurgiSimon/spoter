import { AudioProvider } from "@/components/audio";
import { BottomNav, MobileTopBar, SideNav } from "@/components/nav";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AudioProvider>
      <div className="flex min-h-dvh">
        <SideNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopBar />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 sm:px-6 md:pt-10 md:pb-12">
            {children}
          </main>
        </div>
      </div>
      <BottomNav />
    </AudioProvider>
  );
}
