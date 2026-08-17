import logoSvg from "@/assets/logo.svg";
import { FloatingHeader } from "@/components/floating-header";
import { SetupDialog } from "@/components/setup-dialog";
import { MessageBubble } from "@/components/ui/message-bubble";

const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n' color-interpolation-filters='sRGB'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export function HomePage() {
    return (
        <>
            <FloatingHeader />
            <div
                className="pointer-events-none fixed inset-0 z-0 opacity-10"
                style={{ backgroundImage: GRAIN_SVG, backgroundSize: "256px 256px" }}
            />
            <div className="flex flex-col items-center max-w-2xl mx-auto pt-32 pb-20 px-4">
                <div className="flex items-center gap-3 mb-3">
                    <img src={logoSvg} alt="SmartClaws" className="h-10 w-10" />
                    <span
                        className="text-3xl font-semibold tracking-tight"
                        style={{
                            background: "linear-gradient(to right, #FF444D, #00B7A3)",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                        }}
                    >
                        SmartClaws
                    </span>
                </div>
                <p className="text-foreground text-center mb-6 max-w-md font-normal text-md mt-4">
                    Publish sensor data to SKALE and query it with natural language - powered by AI
                    agents.
                </p>

                <div className="w-full mb-8">
                    <p className="text-foreground text-center max-w-md font-normal text-md pb-18 flex items-center justify-center gap-2 flex-wrap mx-auto">
                        Copy
                        <MessageBubble
                            variant="primary"
                            clickable
                            className="inline-flex max-w-none self-auto text-md font-normal"
                        >
                            messages
                        </MessageBubble>
                        to your agent to setup:
                    </p>
                    <SetupDialog />
                </div>
            </div>
        </>
    );
}
