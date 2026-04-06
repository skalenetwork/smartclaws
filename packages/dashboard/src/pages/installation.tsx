import { useEffect, useState } from "react";
import { Sparkles, Terminal } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyBlock } from "@/components/ui/copy-block";
import { MessageBubble } from "@/components/ui/message-bubble";
import { SetupDialog } from "@/components/setup-dialog";
import { useHeaderActions } from "@/components/layout/header-context";
import { cn } from "@/lib/utils";

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-sm bg-muted px-1.5 py-0.5 rounded-md text-foreground">
      {children}
    </code>
  );
}

function TabSwitch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center bg-muted/50 rounded-lg p-0.5 gap-0.5">
      <button
        type="button"
        onClick={() => onChange("automatic")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
          value === "automatic"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Sparkles className="h-3.5 w-3.5" /> Automatic
      </button>
      <button
        type="button"
        onClick={() => onChange("manual")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
          value === "manual"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Terminal className="h-3.5 w-3.5" /> Manual
      </button>
    </div>
  );
}

export function InstallationPage() {
  const [tab, setTab] = useState("automatic");
  const { setActions } = useHeaderActions();

  useEffect(() => {
    setActions(<TabSwitch value={tab} onChange={setTab} />);
  }, [tab, setActions]);

  useEffect(() => {
    return () => setActions(null);
  }, [setActions]);

  return (
    <div>
      {tab === "automatic" && (
        <div className="max-w-2xl mx-auto py-4">
          <p className="text-center text-xl font-medium pt-6 pb-8 flex items-center justify-center gap-2 flex-wrap">
            Copy
            <MessageBubble variant="primary" clickable className="inline-flex max-w-none self-auto text-xl font-medium">
              messages
            </MessageBubble>
            to your agent to setup:
          </p>
          <SetupDialog />
        </div>
      )}

      {tab === "manual" && (
        <Card>
          <CardHeader>
            <CardTitle>Manual Setup</CardTitle>
            <CardDescription>
              Clone the repository and install skills from source.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CopyBlock code={`git clone https://github.com/skalenetwork/smartclaws.git
cd smartclaws

# Copy skills into your OpenClaw workspace
cp -r skills/smartclaws-producer ~/.openclaw/skills/
cp -r skills/smartclaws-reader ~/.openclaw/skills/`} />
            <p className="text-sm text-muted-foreground">
              Skills are plain directories containing a <InlineCode>SKILL.md</InlineCode> file.
              Place them in your OpenClaw workspace's <InlineCode>skills/</InlineCode> directory
              and they'll be automatically discovered on the next agent session.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
