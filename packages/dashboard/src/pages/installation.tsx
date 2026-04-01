import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
        {number}
      </div>
      <div className="min-w-0 flex-1 space-y-2 pb-6">
        <p className="text-sm font-medium leading-7">{title}</p>
        <div className="text-sm text-muted-foreground space-y-2">{children}</div>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted/50 border border-border px-4 py-3 text-xs font-mono leading-relaxed">
      {children}
    </pre>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted/50 border border-border px-1.5 py-0.5 text-xs font-mono">
      {children}
    </code>
  );
}

export function InstallationPage() {
  return (
    <div>
      <PageHeader
        title="Installation"
        description="Install SmartClaws skills in your OpenClaw agent"
      />

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>OpenClaw Skills</CardTitle>
            <CardDescription>
              SmartClaws provides two skills for OpenClaw agents — one for publishing sensor data and one for reading it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">📡</span>
                  <span className="font-medium text-sm">smartclaws-producer</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Set up IoT sensors and publish data to SKALE blockchain.
                  Handles device registration, sensor script generation, and periodic publishing.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="glass">IoT</Badge>
                  <Badge variant="glass">Sensors</Badge>
                  <Badge variant="glass">Publishing</Badge>
                </div>
              </div>
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">📊</span>
                  <span className="font-medium text-sm">smartclaws-reader</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Read and analyze on-chain IoT data. Answer questions about sensor readings,
                  compute averages, detect thresholds, and describe trends.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="glass">Analytics</Badge>
                  <Badge variant="glass">Reading</Badge>
                  <Badge variant="glass">Queries</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Install from ClawHub</CardTitle>
            <CardDescription>
              Install skills directly into your OpenClaw workspace using the CLI.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              <Step number={1} title="Install the producer skill (on your gateway / Raspberry Pi)">
                <Code>openclaw skills install smartclaws-producer</Code>
                <p>
                  This downloads the skill into your workspace and makes it available to your agent.
                  The agent will be able to set up SmartClaws, register devices, and write sensor publishing scripts.
                </p>
              </Step>

              <Step number={2} title="Install the reader skill (on your querying machine)">
                <Code>openclaw skills install smartclaws-reader</Code>
                <p>
                  Install this on any machine where you want to query sensor data.
                  The agent will read on-chain data and answer natural-language questions about your measurements.
                </p>
              </Step>

              <Step number={3} title="Tell your agent to set up SmartClaws">
                <p>Message your OpenClaw agent:</p>
                <Code>setup smartclaws</Code>
                <p>
                  The agent will download the SmartClaws CLI, initialize the configuration, and generate a wallet.
                  It will then show you the wallet address — you need to fund it with sFUEL before the agent
                  can register a device group or publish data.
                </p>
              </Step>

              <Step number={4} title="Fund the wallet">
                <p>
                  Copy the wallet address the agent shows you and fund it with sFUEL (e.g., via the SKALE faucet
                  or by transferring from another wallet). Once funded, tell the agent to continue — it will
                  register a device group on the SKALE testnet.
                </p>
              </Step>

              <Step number={5} title="Set up a sensor (producer side)">
                <p>Message your agent with your hardware details:</p>
                <Code>setup a temperature sensor for me</Code>
                <p>
                  The agent will register a device, ask about your hardware, write a Python script
                  tailored to your sensor, and start publishing data to the blockchain.
                </p>
              </Step>

              <Step number={6} title="Query your data (reader side)">
                <p>On the reader machine, ask questions naturally:</p>
                <Code>what's the current temperature?</Code>
                <p>
                  The agent reads on-chain data using the channel address from the producer and responds
                  with the latest sensor values. You can also ask for averages, trends, and threshold checks.
                </p>
              </Step>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manual Installation</CardTitle>
            <CardDescription>
              Alternatively, clone the repository and install skills from source.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Code>{`git clone https://github.com/skalenetwork/smartclaws.git
cd smartclaws

# Copy skills into your OpenClaw workspace
cp -r skills/smartclaws-producer ~/.openclaw/skills/
cp -r skills/smartclaws-reader ~/.openclaw/skills/`}</Code>
            <p className="text-xs text-muted-foreground">
              Skills are plain directories containing a <InlineCode>SKILL.md</InlineCode> file.
              Place them in your OpenClaw workspace's <InlineCode>skills/</InlineCode> directory
              and they'll be automatically discovered on the next agent session.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
