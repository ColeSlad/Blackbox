import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";

import type {
  ChangedPath,
  CreatedBranch,
  GitAdapterOptions,
  GitChangeKind,
  GitEntryType,
  GitObjectFormat,
  GitPatchResult,
  GitRepository,
  RepositoryHead,
  RepositoryRegistration,
  RepositoryStatus,
  RegisteredWorktree,
} from "./contracts.js";
import {
  GIT_ERROR_CODES,
  gitError,
  trustedGitError,
  type GitError,
  type GitErrorCode,
} from "./errors.js";

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(["darwin", "linux"]);
const CONTROLLED_TEMPORARY_ROOTS = Object.freeze([
  "/private/tmp",
  "/tmp",
  "/private/var/tmp",
  "/var/tmp",
]);
const SHA1_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_ENVIRONMENT_KEYS = ["PATH"] as const;
const ZERO_SHA: Readonly<Record<GitObjectFormat, string>> = Object.freeze({
  sha1: "0".repeat(40),
  sha256: "0".repeat(64),
});

interface ProcessResult {
  readonly status: number;
  readonly stdout: Buffer;
}

interface RunGitOptions {
  readonly repositoryRoot?: string;
  readonly input?: Uint8Array;
  readonly environment?: Readonly<Record<string, string>>;
}

interface GitCommandRunner {
  createScratchDirectory(prefix: string): Promise<string>;
  run(
    arguments_: readonly string[],
    options?: RunGitOptions,
  ): Promise<ProcessResult>;
}

function assertSupportedPlatform(platform: NodeJS.Platform): void {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw gitError(GIT_ERROR_CODES.unsupportedGit);
  }
}

function normalizeMaxOutputBytes(options: GitAdapterOptions): number {
  const value = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw gitError(GIT_ERROR_CODES.outputLimit);
  }
  return value;
}

function buildGitArguments(
  arguments_: readonly string[],
  repositoryRoot?: string,
): readonly string[] {
  const prefix = [
    "--no-pager",
    "-c",
    "color.ui=false",
    "-c",
    "core.fileMode=true",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.pager=cat",
    "-c",
    "core.useReplaceRefs=false",
    "-c",
    "credential.helper=",
    "-c",
    "diff.external=",
    "-c",
    "interactive.diffFilter=",
    "-c",
    "pager.branch=false",
    "-c",
    "pager.diff=false",
    "-c",
    "pager.status=false",
  ];
  if (repositoryRoot !== undefined) {
    prefix.push("-C", repositoryRoot);
  }
  return Object.freeze([...prefix, ...arguments_]);
}

function controlledEnvironment(
  temporaryRoot: string,
  overrides: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = Object.create(
    null,
  ) as NodeJS.ProcessEnv;
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  Object.assign(environment, {
    HOME: "/dev/null",
    XDG_CONFIG_HOME: "/dev/null",
    LANG: "C",
    LC_ALL: "C",
    GCM_INTERACTIVE: "never",
    GIT_ASKPASS: "/usr/bin/false",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    PAGER: "cat",
    SSH_ASKPASS: "/usr/bin/false",
    ...overrides,
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    TMPDIR: temporaryRoot,
  });
  return environment;
}

function collectOutput(
  chunks: Buffer[],
  chunk: Buffer,
  currentSize: number,
  maxOutputBytes: number,
): number {
  const nextSize = currentSize + chunk.byteLength;
  if (nextSize > maxOutputBytes) {
    throw gitError(GIT_ERROR_CODES.outputLimit);
  }
  chunks.push(chunk);
  return nextSize;
}

class NativeGitCommandRunner implements GitCommandRunner {
  constructor(
    private readonly maxOutputBytes: number,
    private readonly temporaryRoot: string,
    private readonly protectedPaths: readonly string[],
  ) {}

  async createScratchDirectory(prefix: string): Promise<string> {
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(this.temporaryRoot, prefix));
      const canonical = await realpath(directory);
      if (this.protectedPaths.some((path) => isWithinRoot(path, canonical))) {
        throw gitError(GIT_ERROR_CODES.unsupportedRepository);
      }
      return canonical;
    } catch (error) {
      if (directory !== undefined) {
        await rm(directory, { force: true, recursive: true });
      }
      throw trustedGitError(error) ?? gitError(GIT_ERROR_CODES.operationFailed);
    }
  }

  async run(
    arguments_: readonly string[],
    options: RunGitOptions = {},
  ): Promise<ProcessResult> {
    const environment = controlledEnvironment(
      this.temporaryRoot,
      options.environment ?? {},
    );
    return this.spawnGit(
      buildGitArguments(arguments_, options.repositoryRoot),
      environment,
      options.input,
    );
  }

  private spawnGit(
    arguments_: readonly string[],
    environment: NodeJS.ProcessEnv,
    input: Uint8Array | undefined,
  ): Promise<ProcessResult> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn("git", arguments_, {
        env: environment,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutSize = 0;
      let stderrSize = 0;
      let limitError: GitError | undefined;

      const capture = (
        chunks: Buffer[],
        chunk: Buffer,
        stream: "stdout" | "stderr",
      ): void => {
        if (limitError !== undefined) {
          return;
        }
        try {
          if (stream === "stdout") {
            stdoutSize = collectOutput(
              chunks,
              chunk,
              stdoutSize,
              this.maxOutputBytes,
            );
          } else {
            stderrSize = collectOutput(
              chunks,
              chunk,
              stderrSize,
              this.maxOutputBytes,
            );
          }
        } catch (error) {
          limitError =
            trustedGitError(error) ?? gitError(GIT_ERROR_CODES.outputLimit);
          child.kill("SIGKILL");
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        capture(stdoutChunks, chunk, "stdout");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        capture(stderrChunks, chunk, "stderr");
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
        rejectPromise(
          error.code === "ENOENT"
            ? gitError(GIT_ERROR_CODES.executableMissing)
            : gitError(GIT_ERROR_CODES.operationFailed),
        );
      });
      child.once("close", (code) => {
        if (limitError !== undefined) {
          rejectPromise(limitError);
          return;
        }
        if (code === null) {
          rejectPromise(gitError(GIT_ERROR_CODES.operationFailed));
          return;
        }
        resolvePromise({
          status: code,
          stdout: Buffer.concat(stdoutChunks, stdoutSize),
        });
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    });
  }
}

function stableFailure(error: unknown): GitError {
  return trustedGitError(error) ?? gitError(GIT_ERROR_CODES.operationFailed);
}

function expectSuccess(result: ProcessResult, code: GitErrorCode): Buffer {
  if (result.status !== 0) {
    throw gitError(code);
  }
  return result.stdout;
}

function decodeUtf8(buffer: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw gitError(GIT_ERROR_CODES.unsupportedPath);
  }
}

function singleLine(buffer: Uint8Array, code: GitErrorCode): string {
  const value = decodeUtf8(buffer).trimEnd();
  if (value.length === 0 || value.includes("\n") || value.includes("\0")) {
    throw gitError(code);
  }
  return value;
}

function nulFields(buffer: Buffer): readonly string[] {
  if (buffer.byteLength === 0) {
    return Object.freeze([]);
  }
  if (buffer.at(-1) !== 0) {
    throw gitError(GIT_ERROR_CODES.unsupportedGit);
  }
  const fields: string[] = [];
  let start = 0;
  for (let index = 0; index < buffer.byteLength; index += 1) {
    if (buffer[index] === 0) {
      fields.push(decodeUtf8(buffer.subarray(start, index)));
      start = index + 1;
    }
  }
  return Object.freeze(fields);
}

function splitRecord(record: string, fieldCount: number): readonly string[] {
  const fields: string[] = [];
  let start = 0;
  for (let index = 0; index < fieldCount; index += 1) {
    const separator = record.indexOf(" ", start);
    if (separator === -1) {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }
    fields.push(record.slice(start, separator));
    start = separator + 1;
  }
  fields.push(record.slice(start));
  return fields;
}

function normalizeGitPath(root: string, value: string): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.startsWith("/") ||
    isAbsolute(value) ||
    value.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw gitError(GIT_ERROR_CODES.unsupportedPath);
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized === ".") {
    throw gitError(GIT_ERROR_CODES.unsupportedPath);
  }
  const absolutePath = resolve(root, ...normalized.split("/"));
  const rootRelative = relative(root, absolutePath);
  if (
    rootRelative === ".." ||
    rootRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(rootRelative)
  ) {
    throw gitError(GIT_ERROR_CODES.unsupportedPath);
  }
  return normalized;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rootRelative = relative(root, candidate);
  return (
    rootRelative !== ".." &&
    !rootRelative.startsWith("../") &&
    !isAbsolute(rootRelative)
  );
}

async function selectControlledTemporaryRoot(
  protectedPaths: readonly string[],
): Promise<string> {
  for (const candidate of CONTROLLED_TEMPORARY_ROOTS) {
    try {
      const canonical = await realpath(candidate);
      const metadata = await stat(canonical);
      if (
        metadata.isDirectory() &&
        protectedPaths.every((path) => !isWithinRoot(path, canonical))
      ) {
        return canonical;
      }
    } catch {
      continue;
    }
  }
  throw gitError(GIT_ERROR_CODES.unsupportedRepository);
}

async function assertCanonicalParent(
  root: string,
  path: string,
): Promise<void> {
  try {
    const parent = await realpath(dirname(path));
    if (!isWithinRoot(root, parent)) {
      throw gitError(GIT_ERROR_CODES.unsupportedPath);
    }
  } catch (error) {
    throw trustedGitError(error) ?? gitError(GIT_ERROR_CODES.operationFailed);
  }
}

async function detectedEntryType(
  root: string,
  path: string,
): Promise<GitEntryType> {
  const absolutePath = resolve(root, ...path.split("/"));
  await assertCanonicalParent(root, absolutePath);
  try {
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      return "symlink";
    }
    if (metadata.isFile()) {
      return (metadata.mode & 0o111) === 0 ? "regular" : "executable";
    }
    return metadata.isDirectory() ? "gitlink" : "unknown";
  } catch (error) {
    const code =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "code")
        : undefined;
    if (code === "ENOENT") {
      return "absent";
    }
    throw gitError(GIT_ERROR_CODES.operationFailed);
  }
}

function changeKind(code: string): GitChangeKind | null {
  switch (code) {
    case ".":
      return null;
    case "A":
      return "added";
    case "C":
      return "copied";
    case "D":
      return "deleted";
    case "M":
      return "modified";
    case "R":
      return "renamed";
    case "T":
      return "type_changed";
    case "U":
      return "unmerged";
    default:
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
  }
}

function entryType(mode: string): GitEntryType {
  switch (mode) {
    case "000000":
      return "absent";
    case "100644":
      return "regular";
    case "100755":
      return "executable";
    case "120000":
      return "symlink";
    case "160000":
      return "gitlink";
    default:
      return "unknown";
  }
}

function freezeChangedPath(
  root: string,
  path: string,
  stagedChange: GitChangeKind | null,
  unstagedChange: GitChangeKind | null,
  mode: string,
  renamedFrom: string | null,
  untracked: boolean,
): ChangedPath {
  const normalizedPath = normalizeGitPath(root, path);
  const normalizedSource =
    renamedFrom === null ? null : normalizeGitPath(root, renamedFrom);
  return Object.freeze({
    path: normalizedPath,
    staged: stagedChange !== null,
    unstaged: unstagedChange !== null,
    stagedChange,
    unstagedChange,
    deleted: stagedChange === "deleted" || unstagedChange === "deleted",
    renamed: stagedChange === "renamed" || unstagedChange === "renamed",
    renamedFrom: normalizedSource,
    typeChanged:
      stagedChange === "type_changed" || unstagedChange === "type_changed",
    untracked,
    entryType: entryType(mode),
  });
}

function compareChangedPaths(left: ChangedPath, right: ChangedPath): number {
  if (left.path < right.path) {
    return -1;
  }
  if (left.path > right.path) {
    return 1;
  }
  const leftSource = left.renamedFrom ?? "";
  const rightSource = right.renamedFrom ?? "";
  return leftSource < rightSource ? -1 : leftSource > rightSource ? 1 : 0;
}

function parseStatus(root: string, output: Buffer): RepositoryStatus {
  const fields = nulFields(output);
  const changedPaths: ChangedPath[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (record === undefined || record.length < 2) {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }
    if (record.startsWith("1 ")) {
      const parts = splitRecord(record, 8);
      const xy = parts[1];
      const indexMode = parts[4];
      const worktreeMode = parts[5];
      const path = parts[8];
      if (
        xy === undefined ||
        indexMode === undefined ||
        worktreeMode === undefined ||
        path === undefined
      ) {
        throw gitError(GIT_ERROR_CODES.unsupportedGit);
      }
      changedPaths.push(
        freezeChangedPath(
          root,
          path,
          changeKind(xy[0] ?? ""),
          changeKind(xy[1] ?? ""),
          worktreeMode === "000000" ? indexMode : worktreeMode,
          null,
          false,
        ),
      );
      continue;
    }
    if (record.startsWith("2 ")) {
      const parts = splitRecord(record, 9);
      const xy = parts[1];
      const indexMode = parts[4];
      const worktreeMode = parts[5];
      const path = parts[9];
      const source = fields[index + 1];
      if (
        xy === undefined ||
        indexMode === undefined ||
        worktreeMode === undefined ||
        path === undefined ||
        source === undefined
      ) {
        throw gitError(GIT_ERROR_CODES.unsupportedGit);
      }
      changedPaths.push(
        freezeChangedPath(
          root,
          path,
          changeKind(xy[0] ?? ""),
          changeKind(xy[1] ?? ""),
          worktreeMode === "000000" ? indexMode : worktreeMode,
          source,
          false,
        ),
      );
      index += 1;
      continue;
    }
    if (record.startsWith("u ")) {
      const parts = splitRecord(record, 10);
      const worktreeMode = parts[6];
      const path = parts[10];
      if (worktreeMode === undefined || path === undefined) {
        throw gitError(GIT_ERROR_CODES.unsupportedGit);
      }
      changedPaths.push(
        freezeChangedPath(
          root,
          path,
          "unmerged",
          "unmerged",
          worktreeMode,
          null,
          false,
        ),
      );
      continue;
    }
    if (record.startsWith("? ")) {
      changedPaths.push(
        freezeChangedPath(root, record.slice(2), null, "added", "", null, true),
      );
      continue;
    }
    if (record.startsWith("! ")) {
      continue;
    }
    throw gitError(GIT_ERROR_CODES.unsupportedGit);
  }
  changedPaths.sort(compareChangedPaths);
  return Object.freeze({
    clean: changedPaths.length === 0,
    changedPaths: Object.freeze(changedPaths),
  });
}

interface NameStatusChange {
  readonly kind: GitChangeKind;
  readonly path: string;
  readonly renamedFrom: string | null;
}

interface IndexEntry {
  readonly mode: string;
  readonly objectId: string;
  readonly path: string;
}

interface CombinedChange {
  path: string;
  stagedChange: GitChangeKind | null;
  unstagedChange: GitChangeKind | null;
  stagedRenamedFrom: string | null;
  unstagedRenamedFrom: string | null;
}

function parseNameStatus(
  root: string,
  output: Buffer,
): readonly NameStatusChange[] {
  const fields = nulFields(output);
  const changes: NameStatusChange[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index];
    const firstPath = fields[index + 1];
    if (
      status === undefined ||
      firstPath === undefined ||
      status.length === 0
    ) {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }
    const kind = changeKind(status[0] ?? "");
    if (kind === null) {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }
    if (kind === "renamed" || kind === "copied") {
      const destination = fields[index + 2];
      if (destination === undefined || !/^.[0-9]+$/u.test(status)) {
        throw gitError(GIT_ERROR_CODES.unsupportedGit);
      }
      changes.push(
        Object.freeze({
          kind,
          path: normalizeGitPath(root, destination),
          renamedFrom: normalizeGitPath(root, firstPath),
        }),
      );
      index += 2;
    } else {
      if (status.length !== 1) {
        throw gitError(GIT_ERROR_CODES.unsupportedGit);
      }
      changes.push(
        Object.freeze({
          kind,
          path: normalizeGitPath(root, firstPath),
          renamedFrom: null,
        }),
      );
      index += 1;
    }
  }
  return Object.freeze(changes);
}

function parseIndexEntries(
  root: string,
  objectFormat: GitObjectFormat,
  output: Buffer,
): readonly IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const record of nulFields(output)) {
    const separator = record.indexOf("\t");
    const metadata =
      separator === -1 ? [] : record.slice(0, separator).split(" ");
    const path = separator === -1 ? "" : record.slice(separator + 1);
    const mode = metadata[0];
    const objectId = metadata[1];
    const stage = metadata[2];
    if (
      mode === undefined ||
      objectId === undefined ||
      stage !== "0" ||
      !isExactSha(objectId, objectFormat) ||
      !["100644", "100755", "120000"].includes(mode)
    ) {
      throw gitError(GIT_ERROR_CODES.unsupportedRepository);
    }
    entries.push(
      Object.freeze({
        mode,
        objectId,
        path: normalizeGitPath(root, path),
      }),
    );
  }
  return Object.freeze(entries);
}

function modeForEntryType(type: GitEntryType): string {
  switch (type) {
    case "regular":
      return "100644";
    case "executable":
      return "100755";
    case "symlink":
      return "120000";
    case "gitlink":
      return "160000";
    case "absent":
      return "000000";
    default:
      return "";
  }
}

async function combineStatusChanges(
  root: string,
  staged: readonly NameStatusChange[],
  unstaged: readonly NameStatusChange[],
  indexPaths: ReadonlySet<string>,
): Promise<RepositoryStatus> {
  const combined = new Map<string, CombinedChange>();
  for (const change of staged) {
    combined.set(change.path, {
      path: change.path,
      stagedChange: change.kind,
      unstagedChange: null,
      stagedRenamedFrom: change.renamedFrom,
      unstagedRenamedFrom: null,
    });
  }
  for (const change of unstaged) {
    const current = combined.get(change.path) ?? {
      path: change.path,
      stagedChange: null,
      unstagedChange: null,
      stagedRenamedFrom: null,
      unstagedRenamedFrom: null,
    };
    current.unstagedChange = change.kind;
    current.unstagedRenamedFrom = change.renamedFrom;
    combined.set(change.path, current);
  }

  const changedPaths = await Promise.all(
    [...combined.values()].map(async (change) => {
      const finalType = await detectedEntryType(root, change.path);
      return freezeChangedPath(
        root,
        change.path,
        change.stagedChange,
        change.unstagedChange,
        modeForEntryType(finalType),
        change.unstagedRenamedFrom ?? change.stagedRenamedFrom,
        finalType !== "absent" && !indexPaths.has(change.path),
      );
    }),
  );
  changedPaths.sort(compareChangedPaths);
  return Object.freeze({
    clean: changedPaths.length === 0,
    changedPaths: Object.freeze(changedPaths),
  });
}

function freezeHead(
  commitSha: string,
  currentBranch: string | null,
): RepositoryHead {
  return Object.freeze({
    commitSha,
    attached: currentBranch !== null,
    currentBranch,
  });
}

function isExactSha(value: string, objectFormat: GitObjectFormat): boolean {
  return objectFormat === "sha1"
    ? SHA1_PATTERN.test(value)
    : SHA256_PATTERN.test(value);
}

function structurallyValidBranchName(value: string): boolean {
  const forbiddenCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x20 || codePoint === 0x7f || "~^:?*[\\".includes(character)
    );
  });
  return (
    value.length > 0 &&
    value.length <= 255 &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.includes("@{") &&
    !value.split("/").some((part) => part.endsWith(".lock")) &&
    !forbiddenCharacter
  );
}

async function assertBranchName(
  runner: GitCommandRunner,
  value: string,
  errorCode:
    | typeof GIT_ERROR_CODES.branchInvalid
    | typeof GIT_ERROR_CODES.defaultBranchInvalid,
): Promise<void> {
  if (typeof value !== "string" || !structurallyValidBranchName(value)) {
    throw gitError(errorCode);
  }
  const result = await runner.run(["check-ref-format", "--branch", value]);
  if (result.status !== 0) {
    throw gitError(errorCode);
  }
}

function quotedAlternateObjectPath(value: string): string {
  return JSON.stringify(value);
}

function canonicalWorktreePath(value: string): string {
  if (value.length === 0 || value.includes("\0") || !isAbsolute(value)) {
    throw gitError(GIT_ERROR_CODES.unsupportedPath);
  }
  return resolve(value);
}

function parseWorktreeList(
  output: Buffer,
  objectFormat: GitObjectFormat,
): readonly RegisteredWorktree[] {
  interface ParsedWorktree {
    path?: string;
    headCommitSha?: string;
    branch?: string | null;
  }
  const fields = nulFields(output);
  const worktrees: RegisteredWorktree[] = [];
  let current: ParsedWorktree = {};
  const finish = (): void => {
    if (current.path === undefined) {
      if (Object.keys(current).length !== 0) {
        throw gitError(GIT_ERROR_CODES.unsupportedGit);
      }
      return;
    }
    if (
      current.headCommitSha === undefined ||
      !isExactSha(current.headCommitSha, objectFormat)
    ) {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }
    worktrees.push(
      Object.freeze({
        path: canonicalWorktreePath(current.path),
        headCommitSha: current.headCommitSha,
        branch: current.branch ?? null,
      }),
    );
    current = {};
  };
  for (const field of fields) {
    if (field === "") {
      finish();
    } else if (field.startsWith("worktree ")) {
      if (current.path !== undefined) {
        throw gitError(GIT_ERROR_CODES.unsupportedGit);
      }
      current.path = field.slice("worktree ".length);
    } else if (field.startsWith("HEAD ")) {
      current.headCommitSha = field.slice("HEAD ".length);
    } else if (field.startsWith("branch refs/heads/")) {
      current.branch = field.slice("branch refs/heads/".length);
    } else if (
      field === "detached" ||
      field === "bare" ||
      field.startsWith("locked") ||
      field.startsWith("prunable")
    ) {
      continue;
    } else {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }
  }
  finish();
  return Object.freeze(
    worktrees.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
  );
}

class NativeGitRepository implements GitRepository {
  readonly registration: RepositoryRegistration;

  constructor(
    registration: RepositoryRegistration,
    private readonly runner: GitCommandRunner,
  ) {
    this.registration = registration;
  }

  async getHead(): Promise<RepositoryHead> {
    try {
      await this.assertOperationSafety();
      const commitSha = await this.readHeadCommit();
      const branchResult = await this.runner.run(
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        { repositoryRoot: this.registration.identity.workingTreeRoot },
      );
      if (branchResult.status !== 0 && branchResult.status !== 1) {
        throw gitError(GIT_ERROR_CODES.operationFailed);
      }
      const currentBranch =
        branchResult.status === 0
          ? singleLine(branchResult.stdout, GIT_ERROR_CODES.operationFailed)
          : null;
      return freezeHead(commitSha, currentBranch);
    } catch (error) {
      throw stableFailure(error);
    }
  }

  async getStatus(): Promise<RepositoryStatus> {
    try {
      await this.assertOperationSafety();
      const headCommit = await this.readHeadCommit();
      const temporaryDirectory = await this.runner.createScratchDirectory(
        "blackbox-git-status-",
      );
      try {
        const objectDirectory = join(temporaryDirectory, "objects");
        await mkdir(objectDirectory, { recursive: true });
        const sharedEnvironment = Object.freeze({
          GIT_ALTERNATE_OBJECT_DIRECTORIES: quotedAlternateObjectPath(
            join(this.registration.identity.commonGitDirectory, "objects"),
          ),
          GIT_OBJECT_DIRECTORY: objectDirectory,
        });
        const indexEntries = await this.currentIndexEntries();
        const staged = parseNameStatus(
          this.registration.identity.workingTreeRoot,
          expectSuccess(
            await this.runner.run(
              [
                "diff",
                "--cached",
                "--name-status",
                "-z",
                "--no-ext-diff",
                "--no-textconv",
                "--find-renames=50%",
                "--ita-invisible-in-index",
                headCommit,
                "--",
              ],
              { repositoryRoot: this.registration.identity.workingTreeRoot },
            ),
            GIT_ERROR_CODES.operationFailed,
          ),
        );
        const stagedWithIntentToAdd = parseNameStatus(
          this.registration.identity.workingTreeRoot,
          expectSuccess(
            await this.runner.run(
              [
                "diff",
                "--cached",
                "--name-status",
                "-z",
                "--no-ext-diff",
                "--no-textconv",
                "--find-renames=50%",
                "--ita-visible-in-index",
                headCommit,
                "--",
              ],
              { repositoryRoot: this.registration.identity.workingTreeRoot },
            ),
            GIT_ERROR_CODES.operationFailed,
          ),
        );
        const stagedPaths = new Set(staged.map(({ path }) => path));
        const intentToAddPaths = new Set(
          stagedWithIntentToAdd
            .filter(({ path }) => !stagedPaths.has(path))
            .map(({ path }) => path),
        );
        const stagedEnvironment = Object.freeze({
          ...sharedEnvironment,
          GIT_INDEX_FILE: join(temporaryDirectory, "staged-index"),
        });
        await this.populateTemporaryIndex(
          indexEntries.filter(({ path }) => !intentToAddPaths.has(path)),
          stagedEnvironment,
        );
        const indexTree = singleLine(
          expectSuccess(
            await this.runner.run(["write-tree"], {
              repositoryRoot: this.registration.identity.workingTreeRoot,
              environment: stagedEnvironment,
            }),
            GIT_ERROR_CODES.operationFailed,
          ),
          GIT_ERROR_CODES.operationFailed,
        );
        if (!isExactSha(indexTree, this.registration.objectFormat)) {
          throw gitError(GIT_ERROR_CODES.unsupportedGit);
        }

        const worktreeEnvironment = Object.freeze({
          ...sharedEnvironment,
          GIT_INDEX_FILE: join(temporaryDirectory, "worktree-index"),
        });
        expectSuccess(
          await this.runner.run(["read-tree", "--empty"], {
            repositoryRoot: this.registration.identity.workingTreeRoot,
            environment: worktreeEnvironment,
          }),
          GIT_ERROR_CODES.operationFailed,
        );
        const paths = await this.currentWorktreePaths();
        for (const path of paths) {
          await this.addPathToTemporaryIndex(path, worktreeEnvironment);
        }
        const unstaged = parseNameStatus(
          this.registration.identity.workingTreeRoot,
          expectSuccess(
            await this.runner.run(
              [
                "diff",
                "--cached",
                "--name-status",
                "-z",
                "--no-ext-diff",
                "--no-textconv",
                "--find-renames=50%",
                indexTree,
                "--",
              ],
              {
                repositoryRoot: this.registration.identity.workingTreeRoot,
                environment: worktreeEnvironment,
              },
            ),
            GIT_ERROR_CODES.operationFailed,
          ),
        );
        return await combineStatusChanges(
          this.registration.identity.workingTreeRoot,
          staged,
          unstaged,
          new Set(indexEntries.map(({ path }) => path)),
        );
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    } catch (error) {
      throw stableFailure(error);
    }
  }

  async getDiff(baseCommitSha: string): Promise<Uint8Array> {
    const patch = await this.createPatch(baseCommitSha);
    return Uint8Array.from(patch.bytes);
  }

  async createPatch(baseCommitSha: string): Promise<GitPatchResult> {
    try {
      await this.assertOperationSafety();
      await this.assertCommit(baseCommitSha);
      const temporaryDirectory = await this.runner.createScratchDirectory(
        "blackbox-git-patch-",
      );
      try {
        const indexFile = join(temporaryDirectory, "index");
        const objectDirectory = join(temporaryDirectory, "objects");
        await mkdir(objectDirectory, { recursive: true });
        const environment = Object.freeze({
          GIT_ALTERNATE_OBJECT_DIRECTORIES: quotedAlternateObjectPath(
            join(this.registration.identity.commonGitDirectory, "objects"),
          ),
          GIT_INDEX_FILE: indexFile,
          GIT_OBJECT_DIRECTORY: objectDirectory,
        });
        expectSuccess(
          await this.runner.run(["read-tree", "--empty"], {
            repositoryRoot: this.registration.identity.workingTreeRoot,
            environment,
          }),
          GIT_ERROR_CODES.operationFailed,
        );
        const paths = await this.currentWorktreePaths();
        for (const path of paths) {
          await this.addPathToTemporaryIndex(path, environment);
        }
        const patch = expectSuccess(
          await this.runner.run(
            [
              "diff",
              "--cached",
              "--binary",
              "--full-index",
              "--no-ext-diff",
              "--no-textconv",
              "--no-indent-heuristic",
              "--diff-algorithm=myers",
              "--find-renames=50%",
              "--unified=3",
              "-O/dev/null",
              "--src-prefix=a/",
              "--dst-prefix=b/",
              baseCommitSha,
              "--",
            ],
            {
              repositoryRoot: this.registration.identity.workingTreeRoot,
              environment,
            },
          ),
          GIT_ERROR_CODES.operationFailed,
        );
        const bytes = Uint8Array.from(patch);
        return Object.freeze({
          baseCommitSha,
          bytes,
          sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        });
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    } catch (error) {
      throw stableFailure(error);
    }
  }

  async createBranch(
    branchName: string,
    startCommitSha: string,
  ): Promise<CreatedBranch> {
    try {
      await this.assertOperationSafety();
      await assertBranchName(
        this.runner,
        branchName,
        GIT_ERROR_CODES.branchInvalid,
      );
      await this.assertCommit(startCommitSha);
      const ref = `refs/heads/${branchName}`;
      const existing = await this.runner.run(
        ["show-ref", "--verify", "--quiet", ref],
        { repositoryRoot: this.registration.identity.workingTreeRoot },
      );
      if (existing.status === 0) {
        throw gitError(GIT_ERROR_CODES.branchExists);
      }
      if (existing.status !== 1) {
        throw gitError(GIT_ERROR_CODES.operationFailed);
      }
      const created = await this.runner.run(
        [
          "update-ref",
          ref,
          startCommitSha,
          ZERO_SHA[this.registration.objectFormat],
        ],
        { repositoryRoot: this.registration.identity.workingTreeRoot },
      );
      if (created.status !== 0) {
        const collision = await this.runner.run(
          ["show-ref", "--verify", "--quiet", ref],
          { repositoryRoot: this.registration.identity.workingTreeRoot },
        );
        throw gitError(
          collision.status === 0
            ? GIT_ERROR_CODES.branchExists
            : GIT_ERROR_CODES.operationFailed,
        );
      }
      return Object.freeze({ name: branchName, commitSha: startCommitSha });
    } catch (error) {
      throw stableFailure(error);
    }
  }

  async assertCommitExists(commitSha: string): Promise<void> {
    try {
      await this.assertOperationSafety();
      await this.assertCommit(commitSha);
    } catch (error) {
      throw stableFailure(error);
    }
  }

  async getBranchCommit(branchName: string): Promise<string | null> {
    try {
      await this.assertOperationSafety();
      await assertBranchName(
        this.runner,
        branchName,
        GIT_ERROR_CODES.branchInvalid,
      );
      const ref = `refs/heads/${branchName}`;
      const exists = await this.runner.run(
        ["show-ref", "--verify", "--quiet", ref],
        { repositoryRoot: this.registration.identity.workingTreeRoot },
      );
      if (exists.status === 1) {
        return null;
      }
      if (exists.status !== 0) {
        throw gitError(GIT_ERROR_CODES.operationFailed);
      }
      const result = await this.runner.run(
        ["show-ref", "--verify", "--hash", ref],
        {
          repositoryRoot: this.registration.identity.workingTreeRoot,
        },
      );
      const commitSha = singleLine(
        expectSuccess(result, GIT_ERROR_CODES.operationFailed),
        GIT_ERROR_CODES.operationFailed,
      );
      if (!isExactSha(commitSha, this.registration.objectFormat)) {
        throw gitError(GIT_ERROR_CODES.unsupportedGit);
      }
      return commitSha;
    } catch (error) {
      throw stableFailure(error);
    }
  }

  async listWorktrees(): Promise<readonly RegisteredWorktree[]> {
    try {
      await this.assertOperationSafety();
      return parseWorktreeList(
        expectSuccess(
          await this.runner.run(["worktree", "list", "--porcelain", "-z"], {
            repositoryRoot: this.registration.identity.workingTreeRoot,
          }),
          GIT_ERROR_CODES.unsupportedGit,
        ),
        this.registration.objectFormat,
      );
    } catch (error) {
      throw stableFailure(error);
    }
  }

  async hasUnknownContent(): Promise<boolean> {
    try {
      await this.assertOperationSafety();
      const fields = nulFields(
        expectSuccess(
          await this.runner.run(["ls-files", "-z", "--others", "--"], {
            repositoryRoot: this.registration.identity.workingTreeRoot,
          }),
          GIT_ERROR_CODES.operationFailed,
        ),
      );
      for (const field of fields) {
        normalizeGitPath(this.registration.identity.workingTreeRoot, field);
      }
      return fields.length !== 0;
    } catch (error) {
      throw stableFailure(error);
    }
  }

  async addWorktree(
    path: string,
    branchName: string,
  ): Promise<RegisteredWorktree> {
    try {
      await this.assertOperationSafety();
      const normalizedPath = canonicalWorktreePath(path);
      await assertBranchName(
        this.runner,
        branchName,
        GIT_ERROR_CODES.branchInvalid,
      );
      const branchCommit = await this.getBranchCommit(branchName);
      if (branchCommit === null) {
        throw gitError(GIT_ERROR_CODES.branchMissing);
      }
      const result = await this.runner.run(
        ["worktree", "add", "--", normalizedPath, branchName],
        { repositoryRoot: this.registration.identity.workingTreeRoot },
      );
      if (result.status !== 0) {
        throw gitError(GIT_ERROR_CODES.worktreeCollision);
      }
      const created = (await this.listWorktrees()).find(
        (worktree) => worktree.path === normalizedPath,
      );
      if (
        created === undefined ||
        created.branch !== branchName ||
        created.headCommitSha !== branchCommit
      ) {
        throw gitError(GIT_ERROR_CODES.operationFailed);
      }
      return created;
    } catch (error) {
      throw stableFailure(error);
    }
  }

  async removeWorktree(
    path: string,
    expectedBranchName: string,
    expectedHeadCommitSha: string,
  ): Promise<void> {
    try {
      await this.assertOperationSafety();
      const normalizedPath = canonicalWorktreePath(path);
      await assertBranchName(
        this.runner,
        expectedBranchName,
        GIT_ERROR_CODES.branchInvalid,
      );
      if (!isExactSha(expectedHeadCommitSha, this.registration.objectFormat)) {
        throw gitError(GIT_ERROR_CODES.shaInvalid);
      }
      const registrations = await this.listWorktrees();
      const pathRegistrations = registrations.filter(
        (worktree) => worktree.path === normalizedPath,
      );
      const branchRegistrations = registrations.filter(
        (worktree) => worktree.branch === expectedBranchName,
      );
      if (
        pathRegistrations.length !== 1 ||
        branchRegistrations.length !== 1 ||
        pathRegistrations[0]?.branch !== expectedBranchName ||
        pathRegistrations[0]?.headCommitSha !== expectedHeadCommitSha ||
        branchRegistrations[0]?.path !== normalizedPath
      ) {
        throw gitError(GIT_ERROR_CODES.worktreeCollision);
      }
      await this.assertWorktreeRemovalIdentity(
        normalizedPath,
        expectedBranchName,
        expectedHeadCommitSha,
      );
      expectSuccess(
        await this.runner.run(["worktree", "remove", "--", normalizedPath], {
          repositoryRoot: this.registration.identity.workingTreeRoot,
        }),
        GIT_ERROR_CODES.operationFailed,
      );
      if (
        (await this.listWorktrees()).some(
          (worktree) => worktree.path === normalizedPath,
        )
      ) {
        throw gitError(GIT_ERROR_CODES.operationFailed);
      }
    } catch (error) {
      throw stableFailure(error);
    }
  }

  private async assertWorktreeRemovalIdentity(
    path: string,
    expectedBranchName: string,
    expectedHeadCommitSha: string,
  ): Promise<void> {
    try {
      const root = await canonicalDirectory(
        singleLine(
          expectSuccess(
            await this.runner.run(
              ["rev-parse", "--path-format=absolute", "--show-toplevel"],
              { repositoryRoot: path },
            ),
            GIT_ERROR_CODES.worktreeCollision,
          ),
          GIT_ERROR_CODES.worktreeCollision,
        ),
      );
      const commonGitDirectory = await canonicalDirectory(
        singleLine(
          expectSuccess(
            await this.runner.run(
              ["rev-parse", "--path-format=absolute", "--git-common-dir"],
              { repositoryRoot: path },
            ),
            GIT_ERROR_CODES.worktreeCollision,
          ),
          GIT_ERROR_CODES.worktreeCollision,
        ),
      );
      const headCommitSha = singleLine(
        expectSuccess(
          await this.runner.run(["rev-parse", "--verify", "HEAD"], {
            repositoryRoot: path,
          }),
          GIT_ERROR_CODES.worktreeCollision,
        ),
        GIT_ERROR_CODES.worktreeCollision,
      );
      const branchName = singleLine(
        expectSuccess(
          await this.runner.run(
            ["symbolic-ref", "--quiet", "--short", "HEAD"],
            { repositoryRoot: path },
          ),
          GIT_ERROR_CODES.worktreeCollision,
        ),
        GIT_ERROR_CODES.worktreeCollision,
      );
      if (
        root !== path ||
        commonGitDirectory !== this.registration.identity.commonGitDirectory ||
        headCommitSha !== expectedHeadCommitSha ||
        branchName !== expectedBranchName
      ) {
        throw gitError(GIT_ERROR_CODES.worktreeCollision);
      }
    } catch {
      throw gitError(GIT_ERROR_CODES.worktreeCollision);
    }
  }

  async deleteBranch(
    branchName: string,
    expectedCommitSha: string,
  ): Promise<void> {
    try {
      await this.assertOperationSafety();
      await assertBranchName(
        this.runner,
        branchName,
        GIT_ERROR_CODES.branchInvalid,
      );
      await this.assertCommit(expectedCommitSha);
      if (branchName === this.registration.defaultBranch) {
        throw gitError(GIT_ERROR_CODES.branchInvalid);
      }
      const ref = `refs/heads/${branchName}`;
      const current = await this.getBranchCommit(branchName);
      if (current !== expectedCommitSha) {
        throw gitError(GIT_ERROR_CODES.branchMissing);
      }
      if (
        (await this.listWorktrees()).some(
          (worktree) => worktree.branch === branchName,
        )
      ) {
        throw gitError(GIT_ERROR_CODES.worktreeCollision);
      }
      expectSuccess(
        await this.runner.run(["update-ref", "-d", ref, expectedCommitSha], {
          repositoryRoot: this.registration.identity.workingTreeRoot,
        }),
        GIT_ERROR_CODES.operationFailed,
      );
    } catch (error) {
      throw stableFailure(error);
    }
  }

  private async assertCommit(commitSha: string): Promise<void> {
    if (
      typeof commitSha !== "string" ||
      !isExactSha(commitSha, this.registration.objectFormat)
    ) {
      throw gitError(GIT_ERROR_CODES.shaInvalid);
    }
    const result = await this.runner.run(["cat-file", "-t", commitSha], {
      repositoryRoot: this.registration.identity.workingTreeRoot,
    });
    if (
      result.status !== 0 ||
      singleLine(result.stdout, GIT_ERROR_CODES.shaUnavailable) !== "commit"
    ) {
      throw gitError(GIT_ERROR_CODES.shaUnavailable);
    }
  }

  private async assertOperationSafety(): Promise<void> {
    await assertSafeRepositoryConfiguration(
      this.runner,
      this.registration.identity.workingTreeRoot,
      this.registration.identity.commonGitDirectory,
    );
  }

  private async readHeadCommit(): Promise<string> {
    const commitSha = singleLine(
      expectSuccess(
        await this.runner.run(["rev-parse", "--verify", "HEAD"], {
          repositoryRoot: this.registration.identity.workingTreeRoot,
        }),
        GIT_ERROR_CODES.unbornRepository,
      ),
      GIT_ERROR_CODES.unbornRepository,
    );
    if (!isExactSha(commitSha, this.registration.objectFormat)) {
      throw gitError(GIT_ERROR_CODES.unsupportedRepository);
    }
    const objectType = await this.runner.run(["cat-file", "-t", commitSha], {
      repositoryRoot: this.registration.identity.workingTreeRoot,
    });
    if (
      objectType.status !== 0 ||
      singleLine(objectType.stdout, GIT_ERROR_CODES.unsupportedRepository) !==
        "commit"
    ) {
      throw gitError(GIT_ERROR_CODES.unsupportedRepository);
    }
    return commitSha;
  }

  private async currentIndexEntries(): Promise<readonly IndexEntry[]> {
    const result = await this.runner.run(["ls-files", "-s", "-z", "--"], {
      repositoryRoot: this.registration.identity.workingTreeRoot,
    });
    return parseIndexEntries(
      this.registration.identity.workingTreeRoot,
      this.registration.objectFormat,
      expectSuccess(result, GIT_ERROR_CODES.operationFailed),
    );
  }

  private async populateTemporaryIndex(
    entries: readonly IndexEntry[],
    environment: Readonly<Record<string, string>>,
  ): Promise<void> {
    expectSuccess(
      await this.runner.run(["read-tree", "--empty"], {
        repositoryRoot: this.registration.identity.workingTreeRoot,
        environment,
      }),
      GIT_ERROR_CODES.operationFailed,
    );
    for (const entry of entries) {
      expectSuccess(
        await this.runner.run(
          [
            "update-index",
            "--add",
            "--cacheinfo",
            `${entry.mode},${entry.objectId},${entry.path}`,
          ],
          {
            repositoryRoot: this.registration.identity.workingTreeRoot,
            environment,
          },
        ),
        GIT_ERROR_CODES.operationFailed,
      );
    }
  }

  private async currentWorktreePaths(): Promise<readonly string[]> {
    const result = await this.runner.run(
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--"],
      { repositoryRoot: this.registration.identity.workingTreeRoot },
    );
    const uniquePaths = new Set<string>();
    for (const value of nulFields(
      expectSuccess(result, GIT_ERROR_CODES.operationFailed),
    )) {
      uniquePaths.add(
        normalizeGitPath(this.registration.identity.workingTreeRoot, value),
      );
    }
    return Object.freeze([...uniquePaths].sort());
  }

  private async addPathToTemporaryIndex(
    path: string,
    environment: Readonly<Record<string, string>>,
  ): Promise<void> {
    const absolutePath = resolve(
      this.registration.identity.workingTreeRoot,
      ...path.split("/"),
    );
    await assertCanonicalParent(
      this.registration.identity.workingTreeRoot,
      absolutePath,
    );
    let fileStat;
    try {
      fileStat = await lstat(absolutePath);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null
          ? Reflect.get(error, "code")
          : undefined;
      if (code === "ENOENT") {
        return;
      }
      throw gitError(GIT_ERROR_CODES.operationFailed);
    }

    let mode: "100644" | "100755" | "120000";
    let content: Uint8Array;
    if (fileStat.isSymbolicLink()) {
      mode = "120000";
      content = await readlink(absolutePath, { encoding: "buffer" });
    } else if (fileStat.isFile()) {
      let handle;
      try {
        handle = await open(
          absolutePath,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        const openedStat = await handle.stat();
        if (!openedStat.isFile()) {
          throw gitError(GIT_ERROR_CODES.unsupportedPath);
        }
        mode = (openedStat.mode & 0o111) === 0 ? "100644" : "100755";
        content = await handle.readFile();
      } finally {
        await handle?.close();
      }
    } else if (fileStat.isDirectory()) {
      throw gitError(GIT_ERROR_CODES.unsupportedRepository);
    } else {
      throw gitError(GIT_ERROR_CODES.unsupportedPath);
    }

    const objectId = singleLine(
      expectSuccess(
        await this.runner.run(
          ["hash-object", "-w", "--no-filters", "--stdin"],
          {
            repositoryRoot: this.registration.identity.workingTreeRoot,
            environment,
            input: content,
          },
        ),
        GIT_ERROR_CODES.operationFailed,
      ),
      GIT_ERROR_CODES.operationFailed,
    );
    if (!isExactSha(objectId, this.registration.objectFormat)) {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }
    expectSuccess(
      await this.runner.run(
        ["update-index", "--add", "--cacheinfo", `${mode},${objectId},${path}`],
        {
          repositoryRoot: this.registration.identity.workingTreeRoot,
          environment,
        },
      ),
      GIT_ERROR_CODES.operationFailed,
    );
  }
}

async function canonicalDirectory(value: string): Promise<string> {
  if (typeof value !== "string" || value.length === 0) {
    throw gitError(GIT_ERROR_CODES.pathInvalid);
  }
  try {
    const canonical = await realpath(value);
    const metadata = await stat(canonical);
    if (!metadata.isDirectory()) {
      throw gitError(GIT_ERROR_CODES.pathInvalid);
    }
    return canonical;
  } catch (error) {
    throw trustedGitError(error) ?? gitError(GIT_ERROR_CODES.pathInvalid);
  }
}

async function assertSafeRepositoryConfiguration(
  runner: GitCommandRunner,
  root: string,
  commonGitDirectory: string,
): Promise<void> {
  for (const path of [
    join(commonGitDirectory, "objects", "info", "alternates"),
    join(commonGitDirectory, "info", "grafts"),
  ]) {
    try {
      const metadata = await stat(path);
      if (metadata.isFile()) {
        throw gitError(GIT_ERROR_CODES.unsupportedRepository);
      }
    } catch (error) {
      const trusted = trustedGitError(error);
      if (trusted !== undefined) {
        throw trusted;
      }
      const code =
        typeof error === "object" && error !== null
          ? Reflect.get(error, "code")
          : undefined;
      if (code !== "ENOENT") {
        throw gitError(GIT_ERROR_CODES.operationFailed);
      }
    }
  }

  const configuration = await runner.run(
    [
      "config",
      "--null",
      "--get-regexp",
      "^(filter\\..*\\.(clean|process|required|smudge)|core\\.sparsecheckout|extensions\\.partialclone|remote\\..*\\.promisor)$",
    ],
    { repositoryRoot: root },
  );
  if (configuration.status !== 0 && configuration.status !== 1) {
    throw gitError(GIT_ERROR_CODES.operationFailed);
  }
  if (configuration.status === 0) {
    for (const record of nulFields(configuration.stdout)) {
      const separator = record.indexOf("\n");
      const key = separator === -1 ? record : record.slice(0, separator);
      const value = separator === -1 ? "" : record.slice(separator + 1);
      if (
        key.startsWith("filter.") ||
        key === "extensions.partialclone" ||
        value.toLowerCase() === "true" ||
        value === "1" ||
        value.toLowerCase() === "yes" ||
        value.toLowerCase() === "on"
      ) {
        throw gitError(GIT_ERROR_CODES.unsupportedRepository);
      }
    }
  }

  const index = await runner.run(["ls-files", "-s", "-z", "--"], {
    repositoryRoot: root,
  });
  for (const record of nulFields(
    expectSuccess(index, GIT_ERROR_CODES.operationFailed),
  )) {
    if (record.startsWith("160000 ")) {
      throw gitError(GIT_ERROR_CODES.unsupportedRepository);
    }
  }
}

async function probeCapabilities(
  runner: GitCommandRunner,
  root: string,
  headSha: string,
): Promise<void> {
  expectSuccess(
    await runner.run(["--version"]),
    GIT_ERROR_CODES.unsupportedGit,
  );
  const capabilityDirectory = await runner.createScratchDirectory(
    "blackbox-git-capabilities-",
  );
  try {
    const statusRepository = join(capabilityDirectory, "status repository");
    expectSuccess(
      await runner.run([
        "init",
        "--quiet",
        "--initial-branch=main",
        statusRepository,
      ]),
      GIT_ERROR_CODES.unsupportedGit,
    );
    await writeFile(join(statusRepository, "probe path"), "probe\n");
    const statusProbe = parseStatus(
      statusRepository,
      expectSuccess(
        await runner.run(
          [
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=all",
            "--renames",
            "--find-renames=50%",
          ],
          { repositoryRoot: statusRepository },
        ),
        GIT_ERROR_CODES.unsupportedGit,
      ),
    );
    if (
      statusProbe.changedPaths.length !== 1 ||
      statusProbe.changedPaths[0]?.path !== "probe path"
    ) {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }
  } finally {
    await rm(capabilityDirectory, { force: true, recursive: true });
  }
  const objectType = await runner.run(["cat-file", "-t", headSha], {
    repositoryRoot: root,
  });
  if (
    objectType.status !== 0 ||
    singleLine(objectType.stdout, GIT_ERROR_CODES.unsupportedGit) !== "commit"
  ) {
    throw gitError(GIT_ERROR_CODES.unsupportedGit);
  }
  expectSuccess(
    await runner.run(
      [
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        headSha,
        headSha,
        "--",
      ],
      { repositoryRoot: root },
    ),
    GIT_ERROR_CODES.unsupportedGit,
  );
  expectSuccess(
    await runner.run(["hash-object", "--no-filters", "--stdin"], {
      repositoryRoot: root,
      input: new Uint8Array(),
    }),
    GIT_ERROR_CODES.unsupportedGit,
  );
  const temporaryDirectory = await runner.createScratchDirectory(
    "blackbox-git-probe-",
  );
  try {
    expectSuccess(
      await runner.run(["read-tree", "--empty"], {
        repositoryRoot: root,
        environment: { GIT_INDEX_FILE: join(temporaryDirectory, "index") },
      }),
      GIT_ERROR_CODES.unsupportedGit,
    );
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
  expectSuccess(
    await runner.run(["update-ref", "--stdin", "-z"], {
      repositoryRoot: root,
      input: new Uint8Array(),
    }),
    GIT_ERROR_CODES.unsupportedGit,
  );
  expectSuccess(
    await runner.run(["worktree", "list", "--porcelain", "-z"], {
      repositoryRoot: root,
    }),
    GIT_ERROR_CODES.unsupportedGit,
  );
}

export async function registerGitRepository(
  repositoryPath: string,
  defaultBranch: string,
  options: GitAdapterOptions = {},
): Promise<GitRepository> {
  try {
    assertSupportedPlatform(process.platform);
    const maxOutputBytes = normalizeMaxOutputBytes(options);
    const inputPath = await canonicalDirectory(repositoryPath);
    let runner = new NativeGitCommandRunner(
      maxOutputBytes,
      await selectControlledTemporaryRoot([inputPath]),
      Object.freeze([inputPath]),
    );
    expectSuccess(
      await runner.run(["--version"]),
      GIT_ERROR_CODES.unsupportedGit,
    );

    const bareResult = await runner.run(["rev-parse", "--is-bare-repository"], {
      repositoryRoot: inputPath,
    });
    if (bareResult.status !== 0) {
      throw gitError(GIT_ERROR_CODES.notRepository);
    }
    if (
      singleLine(bareResult.stdout, GIT_ERROR_CODES.notRepository) === "true"
    ) {
      throw gitError(GIT_ERROR_CODES.bareRepository);
    }

    const root = await canonicalDirectory(
      singleLine(
        expectSuccess(
          await runner.run(
            ["rev-parse", "--path-format=absolute", "--show-toplevel"],
            { repositoryRoot: inputPath },
          ),
          GIT_ERROR_CODES.unsupportedGit,
        ),
        GIT_ERROR_CODES.unsupportedGit,
      ),
    );
    const commonGitDirectory = await canonicalDirectory(
      singleLine(
        expectSuccess(
          await runner.run(
            ["rev-parse", "--path-format=absolute", "--git-common-dir"],
            { repositoryRoot: root },
          ),
          GIT_ERROR_CODES.unsupportedGit,
        ),
        GIT_ERROR_CODES.unsupportedGit,
      ),
    );
    runner = new NativeGitCommandRunner(
      maxOutputBytes,
      await selectControlledTemporaryRoot([root, commonGitDirectory]),
      Object.freeze([root, commonGitDirectory]),
    );
    const objectFormatValue = singleLine(
      expectSuccess(
        await runner.run(["rev-parse", "--show-object-format"], {
          repositoryRoot: root,
        }),
        GIT_ERROR_CODES.unsupportedGit,
      ),
      GIT_ERROR_CODES.unsupportedGit,
    );
    if (objectFormatValue !== "sha1" && objectFormatValue !== "sha256") {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }
    const objectFormat: GitObjectFormat = objectFormatValue;
    const headResult = await runner.run(["rev-parse", "--verify", "HEAD"], {
      repositoryRoot: root,
    });
    if (headResult.status !== 0) {
      throw gitError(GIT_ERROR_CODES.unbornRepository);
    }
    const headSha = singleLine(
      headResult.stdout,
      GIT_ERROR_CODES.unbornRepository,
    );
    if (!isExactSha(headSha, objectFormat)) {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }

    const repository = new NativeGitRepository(
      Object.freeze({
        identity: Object.freeze({
          workingTreeRoot: root,
          commonGitDirectory,
        }),
        objectFormat,
        defaultBranch: "",
        defaultBranchCommitSha: headSha,
        head: freezeHead(headSha, null),
        status: Object.freeze({ clean: true, changedPaths: Object.freeze([]) }),
      }),
      runner,
    );
    await assertBranchName(
      runner,
      defaultBranch,
      GIT_ERROR_CODES.defaultBranchInvalid,
    );
    await assertSafeRepositoryConfiguration(runner, root, commonGitDirectory);
    await probeCapabilities(runner, root, headSha);

    const defaultRef = `refs/heads/${defaultBranch}`;
    const defaultResult = await runner.run(
      ["show-ref", "--verify", "--hash", defaultRef],
      { repositoryRoot: root },
    );
    if (defaultResult.status !== 0) {
      throw gitError(GIT_ERROR_CODES.defaultBranchMissing);
    }
    const defaultBranchCommitSha = singleLine(
      defaultResult.stdout,
      GIT_ERROR_CODES.defaultBranchMissing,
    );
    if (!isExactSha(defaultBranchCommitSha, objectFormat)) {
      throw gitError(GIT_ERROR_CODES.unsupportedGit);
    }
    const defaultObjectType = await runner.run(
      ["cat-file", "-t", defaultBranchCommitSha],
      { repositoryRoot: root },
    );
    if (
      defaultObjectType.status !== 0 ||
      singleLine(
        defaultObjectType.stdout,
        GIT_ERROR_CODES.unsupportedRepository,
      ) !== "commit"
    ) {
      throw gitError(GIT_ERROR_CODES.unsupportedRepository);
    }
    const head = await repository.getHead();
    const status = await repository.getStatus();
    const registration: RepositoryRegistration = Object.freeze({
      identity: Object.freeze({
        workingTreeRoot: root,
        commonGitDirectory,
      }),
      objectFormat,
      defaultBranch,
      defaultBranchCommitSha,
      head,
      status,
    });
    return new NativeGitRepository(registration, runner);
  } catch (error) {
    throw stableFailure(error);
  }
}

export const nativeGitInternals = Object.freeze({
  assertSupportedPlatform,
  parseStatus,
  parseWorktreeList,
});
