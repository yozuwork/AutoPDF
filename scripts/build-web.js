"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const outputFolder = path.join(projectRoot, "web-dist");
const webFiles = ["index.html", "style.css", "pdf-cards.css", "auto-cards.css", "app.js"];

fs.rmSync(outputFolder, { recursive: true, force: true });
fs.mkdirSync(outputFolder, { recursive: true });

for (const file of webFiles) {
  const source = path.join(projectRoot, file);
  if (!fs.existsSync(source)) {
    throw new Error(`缺少網頁必要檔案：${file}`);
  }
  fs.copyFileSync(source, path.join(outputFolder, file));
}

fs.writeFileSync(path.join(outputFolder, ".nojekyll"), "", "utf8");
console.log(`網頁版建置完成：${outputFolder}`);
