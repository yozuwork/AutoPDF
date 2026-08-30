"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const requiredFiles = ["app.py", "index.html", "style.css", "pdf-cards.css", "auto-cards.css", "app.js"];

function fail(message) {
  console.error(`\n打包失敗：${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false
  });

  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`指令結束代碼為 ${result.status}`);
}

function findPython() {
  const candidates = [
    { command: "py", prefix: ["-3"] },
    { command: "python", prefix: [] }
  ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.prefix, "--version"], {
      cwd: projectRoot,
      encoding: "utf8",
      shell: false
    });
    if (!result.error && result.status === 0) return candidate;
  }

  fail("找不到可用的 Python 3。請先從 python.org 安裝 Python，並勾選 Add Python to PATH。");
}

if (process.platform !== "win32") {
  fail(".exe 必須在 Windows 上進行打包。");
}

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(projectRoot, file))) fail(`缺少必要檔案 ${file}`);
}

const python = findPython();
console.log("\n[1/2] 安裝或更新打包依賴…");
run(python.command, [
  ...python.prefix,
  "-m",
  "pip",
  "install",
  "--disable-pip-version-check",
  "-r",
  "requirements-build.txt"
]);

console.log("\n[2/2] 建立單一 Windows 執行檔…");
const addDataArguments = ["index.html", "style.css", "pdf-cards.css", "auto-cards.css", "app.js"]
  .flatMap((file) => ["--add-data", `${file}${path.delimiter}.`]);
const buildName = `ImageToPDF-build-${process.pid}`;

run(python.command, [
  ...python.prefix,
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--windowed",
  "--name",
  buildName,
  ...addDataArguments,
  "app.py"
]);

const temporaryOutput = path.join(projectRoot, "dist", `${buildName}.exe`);
const normalOutput = path.join(projectRoot, "dist", "ImageToPDF.exe");
if (!fs.existsSync(temporaryOutput)) fail("PyInstaller 已結束，但找不到輸出的執行檔。");

let outputPath = normalOutput;
try {
  fs.copyFileSync(temporaryOutput, normalOutput);
  fs.unlinkSync(temporaryOutput);
} catch (error) {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  outputPath = path.join(projectRoot, "dist", `ImageToPDF-update-${timestamp}.exe`);
  fs.renameSync(temporaryOutput, outputPath);
  console.warn("\n原本的 ImageToPDF.exe 正在使用中，因此無法覆寫。");
  console.warn("請關閉舊程式後，使用這次產生的更新版執行檔。");
}

console.log(`\n打包完成：${outputPath}`);
