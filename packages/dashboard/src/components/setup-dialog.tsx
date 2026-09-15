import { MessageBubble } from "@/components/ui/message-bubble";

function StepNumber({ n }: { n: number }) {
    return (
        <span
            className="inline-flex items-center justify-center h-5 w-5 shrink-0 rounded-full text-[10px] text-white align-middle mr-2.5"
            style={{ background: "linear-gradient(to bottom, #FF2A3A, #BE061C)" }}
        >
            {n}
        </span>
    );
}

export function SetupDialog() {
    return (
        <div className="flex flex-col gap-3">
            {/* Step 1: Install OpenClaw */}
            <MessageBubble variant="secondary" clickable={false}>
                <span className="flex items-center">
                    <StepNumber n={1} /> Install OpenClaw on your device, then ask your agent to
                    install the SmartClaws skill, or install it yourself:
                </span>
            </MessageBubble>
            <MessageBubble variant="primary">
                Install the smartclaws skill with{" "}
                <code className="font-mono text-[0.9em]">clawhub install smartclaws</code>
            </MessageBubble>

            {/* Step 2: Let the agent guide setup */}
            <MessageBubble variant="secondary" clickable={false}>
                <span className="flex items-center">
                    <StepNumber n={2} /> The skill teaches the agent how SmartClaws works and drives
                    the full setup. Ask it to get started:
                </span>
            </MessageBubble>
            <MessageBubble variant="primary">Set up SmartClaws</MessageBubble>
        </div>
    );
}
