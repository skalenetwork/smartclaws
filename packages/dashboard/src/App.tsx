import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { WagmiProvider } from "wagmi";
import { AppLayout } from "./components/layout/app-layout";
import { config } from "./config/wagmi";
import { AgentsPage } from "./pages/agents";
import { ChannelDetailPage } from "./pages/channel-detail";
import { DeviceDetailPage } from "./pages/device-detail";
import { DeviceGroupsPage } from "./pages/device-groups";
import { GroupDetailPage } from "./pages/group-detail";
import { OverviewPage } from "./pages/overview";
import { SkillsPage } from "./pages/skills";
import { InstallationPage } from "./pages/installation";

const queryClient = new QueryClient();

export function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="groups" element={<DeviceGroupsPage />} />
              <Route path="groups/:address" element={<GroupDetailPage />} />
              <Route path="devices/:address" element={<DeviceDetailPage />} />
              <Route path="channels/:address" element={<ChannelDetailPage />} />
              <Route path="agents" element={<AgentsPage />} />
              <Route path="skills" element={<SkillsPage />} />
              <Route path="installation" element={<InstallationPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
