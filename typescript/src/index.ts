import { program } from "commander";
import pkg from "../package.json" with { type: "json" };
import { initCommand } from "./commands/init.ts";
import { walletCommand } from "./commands/wallet.ts";

program
  .name("smartclaws")
  .description("SmartClaws CLI — interact with SmartClaws contracts on SKALE")
  .version(pkg.version);

program.addCommand(initCommand);
program.addCommand(walletCommand);

program.parse();
