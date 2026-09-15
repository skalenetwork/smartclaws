import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
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
import { OverviewPage } from "./pages/overview";
import { SetupPage } from "./pages/setup";
import { SkillsPage } from "./pages/skills";

const queryClient = new QueryClient();

export function App() {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <Routes>
                        <Route path="setup" element={<SetupPage />} />
                        <Route element={<AppLayout />}>
                            <Route index element={<OverviewPage />} />
                            {/* Old dashboard URL, kept so shared links still land. */}
                            <Route path="overview" element={<Navigate to="/" replace />} />
                            <Route path="groups" element={<DeviceGroupsPage />} />
                            <Route path="groups/:address" element={<GroupDetailPage />} />
                            <Route path="devices/:address" element={<DeviceDetailPage />} />
                            <Route path="channels/:address" element={<ChannelDetailPage />} />
                            <Route path="agents" element={<AgentsPage />} />
                            <Route path="agents/:address" element={<AgentDetailPage />} />
                            <Route path="access" element={<AccessPage />} />
                            <Route path="skills" element={<SkillsPage />} />
                        </Route>
                    </Routes>
                </BrowserRouter>
                <Toaster />
            </QueryClientProvider>
        </WagmiProvider>
    );
}
