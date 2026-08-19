import { spawnSync } from "node:child_process";

const result = spawnSync("git", ["ls-files", "--cached", "-z"], {
  encoding: "utf8",
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || "Unable to inspect tracked files.\n");
  process.exit(result.status ?? 1);
}

const lockfiles = result.stdout
  .split("\0")
  .filter((path) =>
    path === "package-lock.json" || path.endsWith("/package-lock.json"),
  )
  .sort();

if (lockfiles.length !== 1 || lockfiles[0] !== "package-lock.json") {
  const details = lockfiles.length > 0 ? ` Found: ${lockfiles.join(", ")}.` : "";
  process.stderr.write(
    `Tracked Node lockfiles must be exactly package-lock.json.${details}\n`,
  );
  process.exit(1);
}

process.stdout.write("Tracked Node lockfile: package-lock.json\n");
