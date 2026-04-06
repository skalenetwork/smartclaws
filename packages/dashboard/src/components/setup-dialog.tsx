import { MessageBubble } from "@/components/ui/message-bubble";

function StepNumber({ n }: { n: number }) {
  return (
    <span
      className="inline-flex items-center justify-center h-5 w-5 shrink-0 rounded-full text-[10px] font-bold text-black align-middle mr-1.5"
      style={{ background: "linear-gradient(178deg, #ffd4d7, #ff8594)" }}
    >
      {n}
    </span>
  );
}

export function SetupDialog() {
  return (
    <div className="flex flex-col gap-3">
      {/* Step 1: Install skills */}
      <MessageBubble variant="secondary" clickable={false}>
        <StepNumber n={1} /> Install the skills:
      </MessageBubble>
      <MessageBubble variant="primary">
        Install smartclaws-producer and smartclaws-reader skills from ClawHub
      </MessageBubble>

      {/* Step 2: Set up SmartClaws */}
      <MessageBubble variant="secondary" clickable={false}>
        <StepNumber n={2} /> Initialize the CLI and generate a wallet:
      </MessageBubble>
      <MessageBubble variant="primary">
        Set up SmartClaws and create a new wallet
      </MessageBubble>

      <div className="flex items-center gap-4 my-1">
        <div className="flex-1 h-[1.5px]" style={{ backgroundImage: "repeating-linear-gradient(to right, var(--muted-foreground) 0, var(--muted-foreground) 4px, transparent 4px, transparent 12px)", opacity: 0.4 }} />
        <span className="text-xs text-muted-foreground shrink-0">Transfer CREDITS to the wallet</span>
        <div className="flex-1 h-[1.5px]" style={{ backgroundImage: "repeating-linear-gradient(to right, var(--muted-foreground) 0, var(--muted-foreground) 4px, transparent 4px, transparent 12px)", opacity: 0.4 }} />
      </div>

      {/* Step 3: Register device group */}
      <MessageBubble variant="secondary" clickable={false}>
        <StepNumber n={3} /> Fund the wallet and register:
      </MessageBubble>
      <MessageBubble variant="primary">
        Wallet funded. Register a new device group: my-sensors.
      </MessageBubble>

      {/* Step 4: Set up sensor */}
      <MessageBubble variant="secondary" clickable={false}>
        <StepNumber n={4} /> Connect a sensor and start publishing data:
      </MessageBubble>
      <MessageBubble variant="primary">
        Set up a temperature sensor on my Raspberry Pi and start publishing data
      </MessageBubble>

      {/* Step 5: Query data */}
      <MessageBubble variant="secondary" clickable={false}>
        <StepNumber n={5} /> Query your on-chain data:
      </MessageBubble>
      <MessageBubble variant="primary">
        What's the current temperature? Show me the trend for the last hour
      </MessageBubble>
    </div>
  );
}
