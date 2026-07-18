import packageMetadata from "../package.json" with { type: "json" };

type WriteOutput = (message: string) => void;

export function runCli(
  arguments_: readonly string[],
  writeOutput: WriteOutput = console.log,
): number {
  if (arguments_.length === 1 && arguments_[0] === "--version") {
    writeOutput(packageMetadata.version);
    return 0;
  }

  writeOutput("Usage: blackbox --version");
  return 1;
}
