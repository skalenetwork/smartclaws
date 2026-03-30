import { program } from "commander";

const VERSION = "0.1.0";

program
  .name("smartclaws")
  .description("SmartClaws CLI — interact with SmartClaws contracts on SKALE")
  .version(VERSION);

program
  .command("status")
  .description("Show current configuration and connection status")
  .action(() => {
    console.log(`SmartClaws CLI v${VERSION}`);
    console.log("Config: not yet configured (run 'smartclaws init')");
  });

program.parse();
