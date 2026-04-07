import { Outlet } from "react-router";
import { Header } from "./header";
import { HeaderActionsProvider } from "./header-context";
import { MobileNav } from "./mobile-nav";
import { Sidebar } from "./sidebar";

export function AppLayout() {
  return (
    <HeaderActionsProvider>
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-3 pb-24 md:pb-3">
            <Outlet />
          </main>
        </div>
        <MobileNav />
      </div>
    </HeaderActionsProvider>
  );
}
