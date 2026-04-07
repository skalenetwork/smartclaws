import { program } from "commander";
import pkg from "../../../package.json" with { type: "json" };
import { deviceCommand } from "./commands/device.ts";
import { initCommand } from "./commands/init.ts";
import { publishCommand } from "./commands/publish.ts";
import { readCommand } from "./commands/read.ts";
import { registerCommand } from "./commands/register.ts";
import { walletCommand } from "./commands/wallet.ts";

program
  .name("smartclaws")
  .description("SmartClaws CLI — interact with SmartClaws contracts on SKALE")
  .version(pkg.version);

program.addCommand(initCommand);
program.addCommand(registerCommand);
program.addCommand(deviceCommand);
program.addCommand(publishCommand);
program.addCommand(readCommand);
program.addCommand(walletCommand);

program.parse();
