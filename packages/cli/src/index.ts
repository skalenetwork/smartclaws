import { program } from "commander";
import pkg from "../../../package.json" with { type: "json" };
import { agentCommand } from "./commands/agent.ts";
import { backupCommand } from "./commands/backup.ts";
import { deviceCommand } from "./commands/device.ts";
import { discoverCommand } from "./commands/discover.ts";
import { initCommand } from "./commands/init.ts";
import { publishCommand } from "./commands/publish.ts";
import { readCommand } from "./commands/read.ts";
import { registerCommand } from "./commands/register.ts";
import { syncCommand } from "./commands/sync.ts";
import { walletCommand } from "./commands/wallet.ts";
import { whoamiCommand } from "./commands/whoami.ts";

program
    .name("smartclaws")
    .description("SmartClaws CLI — interact with SmartClaws contracts on SKALE")
    .version(pkg.version);

program.addCommand(initCommand);
program.addCommand(registerCommand);
program.addCommand(deviceCommand);
program.addCommand(agentCommand);
program.addCommand(publishCommand);
program.addCommand(readCommand);
program.addCommand(discoverCommand);
program.addCommand(syncCommand);
program.addCommand(whoamiCommand);
program.addCommand(walletCommand);
program.addCommand(backupCommand);

program.parse();
