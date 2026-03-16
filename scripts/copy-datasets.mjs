import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "datasets");
const destDir = path.join(root, "dist", "datasets");

async function main() {
  const sourceStats = await stat(srcDir);
  if (!sourceStats.isDirectory()) {
    throw new Error("datasets folder is missing.");
  }

  await mkdir(destDir, { recursive: true });
  await cp(srcDir, destDir, { recursive: true });
  console.log("Copied datasets into dist/datasets");
}

main().catch((error) => {
  console.error("Failed to copy datasets:", error);
  process.exit(1);
});
