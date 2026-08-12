import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { WagmiProvider } from "wagmi";
import { AppLayout } from "./components/layout/app-layout";
import { Toaster } from "./components/ui/sonner";
import { config } from "./config/wagmi";
import { AccessPage } from "./pages/access";
import { AgentDetailPage } from "./pages/agent-detail";
import { AgentsPage } from "./pages/agents";
import { ChannelDetailPage } from "./pages/channel-detail";
import { DeviceDetailPage } from "./pages/device-detail";
import { DeviceGroupsPage } from "./pages/device-groups";
import { GroupDetailPage } from "./pages/group-detail";
import { HomePage } from "./pages/home";
import { InstallationPage } from "./pages/installation";
import { OverviewPage } from "./pages/overview";
import { SkillsPage } from "./pages/skills";

const queryClient = new QueryClient();

export function App() {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <Routes>
                        <Route index element={<HomePage />} />
                        <Route element={<AppLayout />}>
                            <Route path="overview" element={<OverviewPage />} />
                            <Route path="groups" element={<DeviceGroupsPage />} />
                            <Route path="groups/:address" element={<GroupDetailPage />} />
                            <Route path="devices/:address" element={<DeviceDetailPage />} />
                            <Route path="channels/:address" element={<ChannelDetailPage />} />
                            <Route path="agents" element={<AgentsPage />} />
                            <Route path="agents/:address" element={<AgentDetailPage />} />
                            <Route path="access" element={<AccessPage />} />
                            <Route path="skills" element={<SkillsPage />} />
                            <Route path="setup" element={<InstallationPage />} />
                        </Route>
                    </Routes>
                </BrowserRouter>
                <Toaster />
            </QueryClientProvider>
        </WagmiProvider>
    );
}
