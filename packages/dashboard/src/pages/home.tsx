import { MessageBubble } from "@/components/ui/message-bubble";
import { SetupDialog } from "@/components/setup-dialog";
import { FloatingHeader } from "@/components/floating-header";
import logoSvg from "@/assets/logo.svg";

export function HomePage() {
  return (
    <>
      <FloatingHeader />
      <div className="flex flex-col items-center max-w-2xl mx-auto py-20 px-4">
        <div className="flex items-center gap-3 mb-3">
          <img src={logoSvg} alt="SmartClaws" className="h-10 w-10" />
          <span className="text-3xl font-medium tracking-tight" style={{ color: "#FFD7DA" }}>SmartClaws</span>
        </div>
        <p className="text-foreground text-center mb-6 max-w-md font-normal text-md mt-4">
          Publish sensor data to SKALE and query it with natural language - powered by AI agents.
        </p>

        <div className="w-full mb-8">
          <p className="text-foreground text-center max-w-md font-normal text-md pb-18 flex items-center justify-center gap-2 flex-wrap mx-auto">
            Copy
            <MessageBubble variant="primary" clickable className="inline-flex max-w-none self-auto text-md font-normal">
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
