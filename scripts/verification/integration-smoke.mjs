import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const expectedVersion = "0.1.0";

function runBuiltProcess(entryPoint, workingDirectory, arguments_ = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPoint, ...arguments_], {
      cwd: workingDirectory,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let standardOutput = "";
    let standardError = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      standardOutput += chunk;
    });
    child.stderr.on("data", (chunk) => {
      standardError += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ signal, standardError, standardOutput, status });
    });
  });
}

function requestVersion(port) {
  return new Promise((resolve, reject) => {
    const request = get(
      { hostname: "127.0.0.1", path: "/version", port },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.once("end", () => {
          resolve({ body, status: response.statusCode });
        });
      },
    );

    request.once("error", reject);
  });
}

test("built application boundaries pass deterministic smoke coverage", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "blackbox-integration-"));
  let server;

  try {
    const cliResult = await runBuiltProcess(
      join(repositoryRoot, "packages/cli/bin/blackbox.js"),
      temporaryRoot,
      ["--version"],
    );
    assert.equal(cliResult.status, 0, cliResult.standardError);
    assert.equal(cliResult.signal, null);
    assert.equal(cliResult.standardOutput.trim(), expectedVersion);

    const serverModule = await import(
      pathToFileURL(join(repositoryRoot, "apps/server/dist/app.js")).href
    );
    server = serverModule.buildServer();
    await server.listen({ host: "127.0.0.1", port: 0 });

    const address = server.server.address();
    assert(address && typeof address !== "string");

    const versionResponse = await requestVersion(address.port);
    assert.equal(versionResponse.status, 200);
    assert.deepEqual(JSON.parse(versionResponse.body), {
      version: expectedVersion,
    });

    const workerResult = await runBuiltProcess(
      join(repositoryRoot, "apps/worker/dist/index.js"),
      temporaryRoot,
    );
    assert.equal(workerResult.status, 0, workerResult.standardError);
    assert.equal(workerResult.signal, null);

    const temporaryWebBuild = join(temporaryRoot, "web");
    await cp(join(repositoryRoot, "apps/web/dist"), temporaryWebBuild, {
      recursive: true,
    });
    const webEntry = await readFile(
      join(temporaryWebBuild, "index.html"),
      "utf8",
    );
    const entryScripts = [
      ...webEntry.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g),
    ];

    assert(entryScripts.length > 0, "web build has no emitted entry script");
    assert(
      entryScripts.some((entry) => entry[0].includes('type="module"')),
      "web build has no module entry script",
    );

    for (const entry of entryScripts) {
      const emittedAsset = await stat(
        join(temporaryWebBuild, entry[1].replace(/^\//, "")),
      );
      assert(emittedAsset.isFile());
    }
  } finally {
    await server?.close();
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});
