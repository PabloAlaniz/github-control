/** Executable entry for the CLI (see cli.ts for the commands). */
import { runCli } from './cli';

runCli(process.argv.slice(2), { env: process.env, log: console.log })
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
