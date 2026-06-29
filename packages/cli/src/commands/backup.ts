import { confirm } from "@inquirer/prompts";
import {
  type BackupInfo,
  cleanBackups,
  createBackup,
  homeExists,
  listBackups,
  restoreBackup,
  SmartClawsError,
} from "@smartclaws/sdk";
import { Command } from "commander";

const WALLET_CAVEAT =
  "Note: backups include the wallet file (a private key). Keep them local; do not sync to the cloud.";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printRemoved(removed: BackupInfo[]): void {
  if (removed.length === 0) {
    console.log("No backups matched.");
    return;
  }
  for (const b of removed) console.log(`  Removed ${b.name}`);
  console.log(`Removed ${removed.length} backup(s).`);
}

function fail(e: unknown): never {
  console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
  process.exit(1);
}

export const backupCommand = new Command("backup").description(
  "Back up the SmartClaws HOME (no subcommand creates a backup; see list/clean/restore)",
);

backupCommand.action(() => {
  try {
    const result = createBackup();
    console.log(`Backup saved: ${result.path}`);
    console.log(`  Name:  ${result.name}`);
    console.log(`  Files: ${result.fileCount}`);
    console.log(WALLET_CAVEAT);
  } catch (e) {
    fail(e);
  }
});

backupCommand
  .command("list")
  .description("List saved backups")
  .action(() => {
    const backups = listBackups();
    if (backups.length === 0) {
      console.log("No backups.");
      return;
    }
    for (const b of backups) {
      console.log(b.name);
      console.log(`  Created:  ${new Date(b.createdAt).toISOString()}`);
      console.log(`  Size:     ${formatSize(b.sizeBytes)}`);
    }
  });

backupCommand
  .command("clean")
  .description("Delete backups (manual retention)")
  .option("--all", "Remove every backup")
  .option("--keep <n>", "Keep the newest N backups, remove the rest")
  .option("--older-than <days>", "Remove backups older than this many days")
  .option("--yes", "Skip the confirmation prompt")
  .action(async (opts) => {
    const interactive = Boolean(process.stdin.isTTY && !opts.yes);
    try {
      const selector = {
        all: Boolean(opts.all),
        keep: opts.keep !== undefined ? Number(opts.keep) : undefined,
        olderThanDays: opts.olderThan !== undefined ? Number(opts.olderThan) : undefined,
      };

      if (interactive) {
        const targets = cleanBackups(undefined, { ...selector, dryRun: true });
        if (targets.length === 0) {
          console.log("No backups matched.");
          return;
        }
        const proceed = await confirm({
          message: `Delete ${targets.length} backup(s)? This cannot be undone.`,
          default: false,
        });
        if (!proceed) {
          console.log("Left backups unchanged.");
          return;
        }
      }

      const removed = cleanBackups(undefined, selector);
      printRemoved(removed);
    } catch (e) {
      fail(e);
    }
  });

backupCommand
  .command("restore")
  .description("Restore the SmartClaws HOME from a backup")
  .argument("<name>", "Backup name (see 'backup list')")
  .option("--yes", "Skip the confirmation prompt")
  .action(async (name: string, opts) => {
    const interactive = Boolean(process.stdin.isTTY && !opts.yes);
    try {
      if (interactive) {
        const warn = homeExists()
          ? "This overwrites the current HOME (a safety backup is taken first). Continue?"
          : "Restore this backup into the HOME?";
        const proceed = await confirm({ message: warn, default: false });
        if (!proceed) {
          console.log("Left HOME unchanged.");
          return;
        }
      }
      const { safetyBackup } = restoreBackup(name);
      console.log(`Restored HOME from ${name}.`);
      if (safetyBackup) console.log(`  Safety backup of previous HOME: ${safetyBackup}`);
      console.log("Run 'smartclaws wallet info' to confirm the active wallet.");
    } catch (e) {
      fail(e);
    }
  });
