import { readFile } from "fs/promises";
import { readdir } from "fs/promises";
import path from "path";

const TARGET_PATTERN = /toLocale(?:Date|Time)String\(\s*["']id-ID["'][\s\S]*?\)/g;
const TIME_ZONE_PATTERN = /timeZone\s*:\s*["']Asia\/Jakarta["']/;

async function collectJsFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function run() {
  const srcFiles = await collectJsFiles(path.resolve("src"));
  const files = srcFiles.filter((filePath) => {
    const normalized = path
      .relative(process.cwd(), filePath)
      .replaceAll("\\", "/");

    if (normalized.startsWith("src/handler/fetchabsensi/")) return true;
    if (normalized === "src/service/dirRequestService.js") return true;
    return /src\/service\/.*Recap.*Service\.js$/.test(normalized);
  });

  const violations = [];

  for (const file of files) {
    const fullPath = path.resolve(file);
    const content = await readFile(fullPath, "utf8");
    const matches = content.matchAll(TARGET_PATTERN);
    for (const match of matches) {
      const callSnippet = match[0];
      if (!TIME_ZONE_PATTERN.test(callSnippet)) {
        const before = content.slice(0, match.index);
        const line = before.split("\n").length;
        violations.push(`${path.relative(process.cwd(), file)}:${line} -> ${callSnippet}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      "Ditemukan penggunaan toLocaleDateString/toLocaleTimeString('id-ID') tanpa timeZone: 'Asia/Jakarta':"
    );
    violations.forEach((entry) => console.error(`- ${entry}`));
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("Gagal menjalankan check timezone Jakarta:", error);
  process.exit(1);
});
