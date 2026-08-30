"use strict";

const fileInput = document.querySelector("#file-input");
const dropZone = document.querySelector("#drop-zone");
const workspace = document.querySelector("#manual-workspace");
const imageList = document.querySelector("#image-list");
const pdfGroups = document.querySelector("#pdf-groups");
const selectedGroupName = document.querySelector("#selected-group-name");
const selectedGroupCount = document.querySelector("#selected-group-count");
const cardTemplate = document.querySelector("#image-card-template");
const fileCount = document.querySelector("#file-count");
const manualStatus = document.querySelector("#manual-status");
const createPdfButton = document.querySelector("#create-pdf");
const namingMode = document.querySelector("#naming-mode");
const namingPreview = document.querySelector("#naming-preview");
const pageSize = document.querySelector("#page-size");
const marginSize = document.querySelector("#margin-size");
const manualClearAfter = document.querySelector("#manual-clear-after");
const manualSelectNew = document.querySelector("#manual-select-new");
const sourceFolder = document.querySelector("#source-folder");
const outputFolder = document.querySelector("#output-folder");
const runOnStartup = document.querySelector("#run-on-startup");
const moveOriginals = document.querySelector("#move-originals");
const settingsStatus = document.querySelector("#settings-status");
const settingsStorageKey = "image-to-pdf-settings-v1";

let images = [];
let draggedId = null;
let selectedGroupId = null;
const manualGroupId = crypto.randomUUID();

function setStatus(message, isError = false) {
  manualStatus.textContent = message;
  manualStatus.classList.toggle("error", isError);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function localDateToken(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("");
}

function getStoredSystemSequence(dateToken) {
  try {
    return Number(localStorage.getItem(`image-to-pdf-sequence:${dateToken}`)) || 0;
  } catch {
    return 0;
  }
}

function reserveSystemNames(count) {
  const dateToken = localDateToken();
  const currentSequence = getStoredSystemSequence(dateToken);
  const names = Array.from({ length: count }, (_, index) => {
    return `${dateToken}${String(currentSequence + index + 1).padStart(3, "0")}`;
  });
  try {
    localStorage.setItem(`image-to-pdf-sequence:${dateToken}`, String(currentSequence + count));
  } catch {
    // 無法使用本機儲存時，仍保證本次批次內的名稱不重複。
  }
  return names;
}

function updateNamingPreview() {
  if (namingMode.value === "folder") {
    namingPreview.textContent = "依照每張 PDF 卡片的資料夾名稱";
    return;
  }
  const dateToken = localDateToken();
  const nextSequence = getStoredSystemSequence(dateToken) + 1;
  namingPreview.textContent = `下一個檔名：${dateToken}${String(nextSequence).padStart(3, "0")}.pdf`;
}

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(settingsStorageKey)) || {};
  } catch {
    return {};
  }
}

function collectSettings() {
  return {
    pageSize: pageSize.value,
    marginSize: marginSize.value,
    namingMode: namingMode.value,
    manualClearAfter: manualClearAfter.checked,
    manualSelectNew: manualSelectNew.checked,
    sourceFolder: sourceFolder.value,
    outputFolder: outputFolder.value,
    runOnStartup: runOnStartup.checked,
    moveOriginals: moveOriginals.checked
  };
}

function optionText(select) {
  return select.options[select.selectedIndex]?.textContent || "";
}

function updateAutoOverview() {
  document.querySelector("#auto-rule-display").textContent = `${optionText(pageSize)}・${optionText(marginSize)}・${optionText(namingMode)}`;
  const autoStatus = document.querySelector("#auto-status");
  if (sourceFolder.value && outputFolder.value) {
    autoStatus.className = "status-line";
    autoStatus.innerHTML = "<span>●</span>設定完成，可以開始轉換";
  } else {
    autoStatus.className = "status-line muted";
    autoStatus.innerHTML = "<span>·</span>請選擇本次的來源與輸出資料夾";
  }
}

function applySettings(settings) {
  pageSize.value = settings.pageSize || "image";
  marginSize.value = settings.marginSize || "24";
  namingMode.value = settings.namingMode || "folder";
  manualClearAfter.checked = Boolean(settings.manualClearAfter);
  manualSelectNew.checked = settings.manualSelectNew !== false;
  sourceFolder.value = settings.sourceFolder || "";
  outputFolder.value = settings.outputFolder || "";
  runOnStartup.checked = Boolean(settings.runOnStartup);
  moveOriginals.checked = Boolean(settings.moveOriginals);
  updateNamingPreview();
  updateAutoOverview();
}

function loadSettings() {
  applySettings(readSettings());
}

async function saveSettings() {
  const settings = collectSettings();
  try {
    localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    if (isDesktopApp && window.pywebview?.api) {
      const saved = await window.pywebview.api.save_settings(settings);
      if (!saved) throw new Error("desktop settings failed");
    }
    settingsStatus.textContent = "設定已儲存並套用至手動與自動轉換";
    settingsStatus.classList.remove("error");
  } catch {
    settingsStatus.textContent = "設定無法儲存，請檢查本機儲存權限";
    settingsStatus.classList.add("error");
  }
  updateNamingPreview();
  updateAutoOverview();
}

function getImageGroups() {
  const groups = [];
  const groupsById = new Map();
  for (const image of images) {
    if (!groupsById.has(image.groupId)) {
      const group = { id: image.groupId, name: image.groupName, images: [] };
      groupsById.set(image.groupId, group);
      groups.push(group);
    }
    groupsById.get(image.groupId).images.push(image);
  }
  return groups;
}

function selectGroup(groupId) {
  selectedGroupId = groupId;
  renderImages();
}

function renderImages() {
  imageList.replaceChildren();
  pdfGroups.replaceChildren();
  const groups = getImageGroups();
  if (!groups.some((group) => group.id === selectedGroupId)) selectedGroupId = groups[0]?.id || null;

  groups.forEach((group, index) => {
    const groupCard = document.createElement("article");
    groupCard.className = `pdf-card${group.id === selectedGroupId ? " selected" : ""}`;
    groupCard.tabIndex = 0;
    groupCard.setAttribute("role", "button");
    groupCard.setAttribute("aria-pressed", String(group.id === selectedGroupId));
    groupCard.setAttribute("aria-label", `PDF ${index + 1}：${group.name}，${group.images.length} 頁`);

    const preview = document.createElement("div");
    preview.className = "pdf-preview";
    for (const item of group.images.slice(0, 4)) {
      const thumbnail = document.createElement("img");
      thumbnail.src = item.url;
      thumbnail.alt = "";
      preview.append(thumbnail);
    }

    const info = document.createElement("div");
    info.className = "pdf-card-info";
    const label = document.createElement("span");
    label.className = "pdf-label";
    label.textContent = `PDF ${index + 1}`;
    const name = document.createElement("strong");
    name.className = "pdf-card-name";
    name.textContent = group.name;
    name.title = group.name;
    const count = document.createElement("span");
    count.className = "pdf-card-count";
    count.textContent = `${group.images.length} 頁`;
    info.append(label, name, count);

    const removeButton = document.createElement("button");
    removeButton.className = "pdf-card-remove";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.title = `移除 ${group.name}`;
    removeButton.setAttribute("aria-label", `移除 ${group.name}`);
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeGroup(group.id);
    });

    groupCard.append(preview, info, removeButton);
    groupCard.addEventListener("click", () => selectGroup(group.id));
    groupCard.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectGroup(group.id);
      }
    });
    pdfGroups.append(groupCard);
  });

  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  selectedGroupName.textContent = selectedGroup ? `${selectedGroup.name} 的圖片順序` : "";
  selectedGroupCount.textContent = selectedGroup ? `${selectedGroup.images.length} 張，可拖曳排序` : "";

  for (const item of selectedGroup?.images || []) {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.id = item.id;
    card.querySelector("img").src = item.url;
    card.querySelector(".file-name").textContent = item.file.name;
    const location = item.relativePath && item.relativePath !== item.file.name
      ? `${item.relativePath} · `
      : "";
    card.querySelector(".file-meta").textContent = `${location}${formatBytes(item.file.size)}`;
    card.querySelector(".remove-button").addEventListener("click", () => removeImage(item.id));

    card.addEventListener("dragstart", () => {
      draggedId = item.id;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      draggedId = null;
      card.classList.remove("dragging");
      document.querySelectorAll(".image-card.drag-over").forEach((element) => element.classList.remove("drag-over"));
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (draggedId && draggedId !== item.id) card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      card.classList.remove("drag-over");
      reorderImage(draggedId, item.id);
    });

    imageList.append(card);
  }

  fileCount.textContent = String(images.length);
  const pdfCount = groups.length;
  createPdfButton.textContent = pdfCount > 1 ? `產生 ${pdfCount} 份 PDF` : "合併成 PDF";
  dropZone.hidden = images.length > 0;
  workspace.hidden = images.length === 0;
}

function isSupportedImage(file) {
  const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  return supportedTypes.has(file.type) || /\.(?:jpe?g|png|webp)$/i.test(file.name);
}

function isZipFile(file) {
  return file.type === "application/zip" || /\.zip$/i.test(file.name);
}

function imageMimeType(fileName) {
  if (/\.png$/i.test(fileName)) return "image/png";
  if (/\.webp$/i.test(fileName)) return "image/webp";
  return "image/jpeg";
}

function findZipEndRecord(view) {
  const minimumOffset = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function decompressZipEntry(compressedData, method) {
  if (method === 0) return compressedData;
  if (method !== 8) throw new Error(`ZIP 使用不支援的壓縮方式（${method}）`);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("此瀏覽器不支援 ZIP 解壓縮，請改用最新版 Chrome 或 Edge");
  }
  const stream = new Blob([compressedData])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractZipImages(zipFile) {
  const archive = new Uint8Array(await zipFile.arrayBuffer());
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const endOffset = findZipEndRecord(view);
  if (endOffset < 0) throw new Error(`「${zipFile.name}」不是有效的 ZIP 檔案`);

  const entryCount = view.getUint16(endOffset + 10, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("目前不支援 ZIP64 格式");
  }
  if (entryCount > 10000) throw new Error("ZIP 內的檔案數量超過 10,000 個");

  const archiveId = crypto.randomUUID();
  const zipBaseName = zipFile.name.replace(/\.zip$/i, "") || "ZIP 圖片";
  const groupIds = new Map();
  const extracted = [];
  let totalSize = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > view.byteLength || view.getUint32(centralOffset, true) !== 0x02014b50) {
      throw new Error(`「${zipFile.name}」的目錄資料已損壞`);
    }

    const flags = view.getUint16(centralOffset + 8, true);
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const uncompressedSize = view.getUint32(centralOffset + 24, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const nameStart = centralOffset + 46;
    const nameBytes = archive.subarray(nameStart, nameStart + nameLength);
    const decoder = new TextDecoder((flags & 0x0800) ? "utf-8" : "utf-8");
    const entryName = decoder.decode(nameBytes).replace(/\\/g, "/").replace(/^\/+/, "");
    centralOffset = nameStart + nameLength + extraLength + commentLength;

    if (!entryName || entryName.endsWith("/") || entryName.startsWith("__MACOSX/")) continue;
    if (!/\.(?:jpe?g|png|webp)$/i.test(entryName)) continue;
    if (flags & 0x0001) throw new Error(`「${entryName}」受到密碼保護，無法讀取`);
    if (uncompressedSize > 512 * 1024 * 1024) throw new Error(`「${entryName}」解壓縮後超過 512 MB`);
    totalSize += uncompressedSize;
    if (totalSize > 2 * 1024 * 1024 * 1024) throw new Error("ZIP 圖片解壓縮後總大小超過 2 GB");

    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`「${entryName}」的檔案資料已損壞`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > archive.byteLength) throw new Error(`「${entryName}」的壓縮資料不完整`);

    const decompressed = await decompressZipEntry(archive.subarray(dataStart, dataEnd), method);
    if (decompressed.byteLength !== uncompressedSize) throw new Error(`「${entryName}」解壓縮大小不正確`);

    const pathParts = entryName.split("/").filter(Boolean);
    const hasTopFolder = pathParts.length > 1;
    const groupName = hasTopFolder ? pathParts[0] : zipBaseName;
    const groupKey = hasTopFolder ? pathParts[0] : "__zip_root__";
    if (!groupIds.has(groupKey)) groupIds.set(groupKey, `${archiveId}:${groupKey}`);
    const fileName = pathParts.at(-1);
    extracted.push({
      file: new File([decompressed], fileName, { type: imageMimeType(fileName) }),
      relativePath: entryName,
      groupId: groupIds.get(groupKey),
      groupName,
      groupType: "archive"
    });
  }

  extracted.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-Hant", {
    numeric: true,
    sensitivity: "base"
  }));
  return extracted;
}

async function expandZipFiles(items) {
  const expanded = [];
  for (const item of items) {
    if (!isZipFile(item.file)) {
      expanded.push(item);
      continue;
    }
    setStatus(`正在解壓縮「${item.file.name}」…`);
    expanded.push(...await extractZipImages(item.file));
  }
  return expanded;
}

function addFiles(fileList, sourceLabel = "") {
  const incoming = [...fileList].map((item) => item.file
    ? item
    : { file: item, relativePath: item.webkitRelativePath || item.name });
  const validFiles = incoming.filter((item) => isSupportedImage(item.file));

  for (const item of validFiles) {
    images.push({
      id: crypto.randomUUID(),
      file: item.file,
      relativePath: item.relativePath,
      groupId: item.groupId || manualGroupId,
      groupName: item.groupName || "圖片合併",
      groupType: item.groupType || "files",
      url: URL.createObjectURL(item.file)
    });
  }

  if (manualSelectNew.checked && validFiles.length) {
    selectedGroupId = validFiles.at(-1).groupId || manualGroupId;
  }
  renderImages();
  if (validFiles.length !== incoming.length) {
    setStatus(`已略過 ${incoming.length - validFiles.length} 個不支援的檔案`, true);
  } else if (validFiles.length) {
    setStatus(`已從${sourceLabel || "拖放內容"}加入 ${validFiles.length} 張圖片`);
  }
  fileInput.value = "";
}

function readFileEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryEntries(directoryEntry) {
  const reader = directoryEntry.createReader();
  const entries = [];

  return new Promise((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function collectEntryFiles(entry) {
  if (entry.isFile) {
    const file = await readFileEntry(entry);
    return [{ file, relativePath: entry.fullPath.replace(/^\//, "") }];
  }

  if (!entry.isDirectory) return [];
  const children = await readDirectoryEntries(entry);
  children.sort((left, right) => left.name.localeCompare(right.name, "zh-Hant", {
    numeric: true,
    sensitivity: "base"
  }));

  const files = [];
  for (const child of children) files.push(...await collectEntryFiles(child));
  return files;
}

async function collectDroppedFiles(dataTransfer) {
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);

  if (!entries.length) {
    return [...dataTransfer.files].map((file) => ({
      file,
      relativePath: file.name,
      groupId: manualGroupId,
      groupName: "圖片合併",
      groupType: "files"
    }));
  }

  entries.sort((left, right) => left.name.localeCompare(right.name, "zh-Hant", {
    numeric: true,
    sensitivity: "base"
  }));
  const files = [];
  for (const entry of entries) {
    const entryFiles = await collectEntryFiles(entry);
    const isFolder = entry.isDirectory;
    const groupId = isFolder ? crypto.randomUUID() : manualGroupId;
    const groupName = isFolder ? entry.name : "圖片合併";
    files.push(...entryFiles.map((item) => ({
      ...item,
      groupId,
      groupName,
      groupType: isFolder ? "folder" : "files"
    })));
  }
  return files;
}

async function handleDrop(event) {
  try {
    setStatus("正在讀取拖曳的檔案與資料夾…");
    const droppedFiles = await collectDroppedFiles(event.dataTransfer);
    const files = await expandZipFiles(droppedFiles);
    const batchCount = new Set(files
      .filter((item) => item.groupType !== "files")
      .map((item) => item.groupId)).size;
    if (!files.length) {
      setStatus("找不到可讀取的圖片，請確認資料夾或 ZIP 內含有 JPG、PNG、WebP", true);
      return;
    }
    addFiles(files, batchCount ? `${batchCount} 個 PDF 批次` : "拖放內容");
  } catch (error) {
    console.error(error);
    setStatus("無法讀取這個資料夾，請確認瀏覽器權限後再試一次", true);
  }
}

function removeImage(id) {
  const item = images.find((image) => image.id === id);
  if (item) URL.revokeObjectURL(item.url);
  images = images.filter((image) => image.id !== id);
  renderImages();
  setStatus(images.length ? "已移除圖片" : "");
}

function removeGroup(groupId) {
  const group = getImageGroups().find((item) => item.id === groupId);
  if (!group) return;
  group.images.forEach((image) => URL.revokeObjectURL(image.url));
  images = images.filter((image) => image.groupId !== groupId);
  if (selectedGroupId === groupId) selectedGroupId = null;
  renderImages();
  setStatus(`已移除「${group.name}」PDF`);
}

function clearImages() {
  images.forEach((image) => URL.revokeObjectURL(image.url));
  images = [];
  selectedGroupId = null;
  renderImages();
  setStatus("");
}

function reorderImage(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const sourceIndex = images.findIndex((image) => image.id === sourceId);
  const targetIndex = images.findIndex((image) => image.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [moved] = images.splice(sourceIndex, 1);
  images.splice(targetIndex, 0, moved);
  renderImages();
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("無法轉換圖片格式"));
    }, "image/jpeg", 0.92);
  });
}

async function prepareImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const jpegBlob = await canvasToJpeg(canvas);
  return {
    width: canvas.width,
    height: canvas.height,
    data: jpegBlob,
    byteLength: jpegBlob.size
  };
}

function ascii(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return bytes;
}

function pageLayout(image, pageMode, margin) {
  let pageWidth;
  let pageHeight;

  if (pageMode === "a4") {
    const landscape = image.width > image.height;
    pageWidth = landscape ? 841.89 : 595.28;
    pageHeight = landscape ? 595.28 : 841.89;
  } else {
    const pointsPerPixel = 0.75;
    pageWidth = image.width * pointsPerPixel + margin * 2;
    pageHeight = image.height * pointsPerPixel + margin * 2;
  }

  const availableWidth = Math.max(1, pageWidth - margin * 2);
  const availableHeight = Math.max(1, pageHeight - margin * 2);
  const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;

  return {
    pageWidth,
    pageHeight,
    drawWidth,
    drawHeight,
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2
  };
}

function buildPdf(preparedImages, pageMode, margin) {
  const pageCount = preparedImages.length;
  const objectCount = 2 + pageCount * 3;
  const objects = new Array(objectCount + 1);
  const pageReferences = [];

  objects[1] = [ascii("<< /Type /Catalog /Pages 2 0 R >>")];

  preparedImages.forEach((image, index) => {
    const pageObject = 3 + index * 3;
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const layout = pageLayout(image, pageMode, margin);
    const number = (value) => Number(value.toFixed(3));
    const content = ascii(`q\n${number(layout.drawWidth)} 0 0 ${number(layout.drawHeight)} ${number(layout.x)} ${number(layout.y)} cm\n/Im0 Do\nQ\n`);

    pageReferences.push(`${pageObject} 0 R`);
    objects[pageObject] = [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(layout.pageWidth)} ${number(layout.pageHeight)}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`)];
    objects[contentObject] = [
      ascii(`<< /Length ${content.length} >>\nstream\n`),
      content,
      ascii("endstream")
    ];
    objects[imageObject] = [
      ascii(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.byteLength} >>\nstream\n`),
      image.data,
      ascii("\nendstream")
    ];
  });

  objects[2] = [ascii(`<< /Type /Pages /Count ${pageCount} /Kids [${pageReferences.join(" ")}] >>`)];

  const chunks = [ascii("%PDF-1.4\n%\xff\xff\xff\xff\n")];
  const offsets = new Array(objectCount + 1).fill(0);
  let currentOffset = chunks[0].length;

  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    const objectParts = [ascii(`${objectNumber} 0 obj\n`), ...objects[objectNumber], ascii("\nendobj\n")];
    offsets[objectNumber] = currentOffset;
    chunks.push(...objectParts);
    currentOffset += objectParts.reduce((total, part) => total + (part.size ?? part.length), 0);
  }

  const xrefOffset = currentOffset;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    xref += `${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(ascii(xref));
  return new Blob(chunks, { type: "application/pdf" });
}

async function createPdf() {
  if (!images.length) return;
  createPdfButton.disabled = true;

  try {
    const groups = getImageGroups();

    const pageMode = document.querySelector("#page-size").value;
    const margin = Number(document.querySelector("#margin-size").value);
    const namingModeValue = namingMode.value;
    const systemNames = namingModeValue === "system" ? reserveSystemNames(groups.length) : [];
    updateNamingPreview();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const usedNames = new Map();
    let processedCount = 0;

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      const preparedImages = [];
      for (const image of group.images) {
        processedCount += 1;
        setStatus(`正在處理第 ${processedCount} / ${images.length} 張圖片（PDF ${groupIndex + 1} / ${groups.length}）…`);
        preparedImages.push(await prepareImage(image.file));
      }

      setStatus(`正在建立第 ${groupIndex + 1} / ${groups.length} 份 PDF…`);
      const pdfBlob = buildPdf(preparedImages, pageMode, margin);
      let baseName;
      if (namingModeValue === "system") {
        baseName = systemNames[groupIndex];
      } else {
        baseName = group.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100) || "圖片合併";
        const duplicateNumber = (usedNames.get(baseName.toLocaleLowerCase()) || 0) + 1;
        usedNames.set(baseName.toLocaleLowerCase(), duplicateNumber);
        if (duplicateNumber > 1) baseName += `-${duplicateNumber}`;
        if (groups.length === 1 && group.name === "圖片合併") baseName += `-${timestamp}`;
      }

      const blobUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${baseName}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      if (groups.length > 1) await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const completedMessage = `已建立 ${groups.length} 份 PDF，共 ${images.length} 頁${groups.length > 1 ? "；若只下載一份，請允許瀏覽器下載多個檔案" : ""}`;
    if (manualClearAfter.checked) clearImages();
    setStatus(completedMessage);
  } catch (error) {
    console.error(error);
    setStatus(`建立失敗：${error instanceof Error ? error.message : "無法處理圖片"}`, true);
  } finally {
    createPdfButton.disabled = false;
  }
}

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", async () => {
  try {
    const selected = [...fileInput.files].map((file) => ({
      file,
      relativePath: file.name,
      groupId: manualGroupId,
      groupName: "圖片合併",
      groupType: "files"
    }));
    addFiles(await expandZipFiles(selected), "選取內容");
  } catch (error) {
    console.error(error);
    setStatus(`無法讀取 ZIP：${error instanceof Error ? error.message : "未知錯誤"}`, true);
    fileInput.value = "";
  }
});
document.querySelector("#add-more").addEventListener("click", () => fileInput.click());
document.querySelector("#clear-all").addEventListener("click", clearImages);
createPdfButton.addEventListener("click", createPdf);

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}
dropZone.addEventListener("drop", handleDrop);

const desktopOnlyModal = document.querySelector("#desktop-only-modal");
const closeDesktopOnlyModal = document.querySelector("#close-desktop-only-modal");
const isDesktopApp = new URLSearchParams(window.location.search).get("desktop") === "1";

window.addEventListener("pywebviewready", async () => {
  if (!isDesktopApp || !window.pywebview?.api) return;
  try {
    const desktopSettings = await window.pywebview.api.load_settings();
    if (desktopSettings && Object.keys(desktopSettings).length) {
      applySettings(desktopSettings);
      localStorage.setItem(settingsStorageKey, JSON.stringify(desktopSettings));
      if (desktopSettings.runOnStartup && desktopSettings.sourceFolder && desktopSettings.outputFolder) {
        runAutoConversion(true);
      }
    }
  } catch (error) {
    console.error("無法載入桌面版設定", error);
  }
});

function showDesktopOnlyNotice() {
  desktopOnlyModal.hidden = false;
  closeDesktopOnlyModal.focus();
}

function hideDesktopOnlyNotice() {
  desktopOnlyModal.hidden = true;
  document.querySelector('[data-pane="auto"]').focus();
}

closeDesktopOnlyModal.addEventListener("click", hideDesktopOnlyNotice);
desktopOnlyModal.addEventListener("click", (event) => {
  if (event.target === desktopOnlyModal) hideDesktopOnlyNotice();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !desktopOnlyModal.hidden) hideDesktopOnlyNotice();
});

if (!isDesktopApp) {
  document.querySelector('[data-pane="auto"]').title = "此功能僅限應用程式版本";
}

function activatePane(paneName) {
  document.querySelectorAll(".rail-button").forEach((item) => {
    const active = item.dataset.pane === paneName;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  document.querySelectorAll(".pane").forEach((pane) => pane.classList.remove("active"));
  document.querySelector(`#pane-${paneName}`).classList.add("active");
}

document.querySelectorAll(".rail-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.pane === "auto" && !isDesktopApp) {
      showDesktopOnlyNotice();
      return;
    }
    activatePane(button.dataset.pane);
  });
});

document.querySelector("#open-auto-settings").addEventListener("click", () => activatePane("settings"));
document.querySelector("#save-settings").addEventListener("click", saveSettings);

for (const element of [pageSize, marginSize, namingMode, manualClearAfter, manualSelectNew, runOnStartup, moveOriginals]) {
  element.addEventListener("change", () => {
    updateNamingPreview();
    updateAutoOverview();
    settingsStatus.textContent = "設定尚未儲存";
  });
}

async function chooseAutomaticFolder(input) {
  if (!isDesktopApp || !window.pywebview?.api) {
    showDesktopOnlyNotice();
    return;
  }
  try {
    const selectedPath = await window.pywebview.api.choose_folder();
    if (selectedPath) {
      input.value = selectedPath;
      updateAutoOverview();
      await saveSettings();
    }
  } catch (error) {
    console.error(error);
    settingsStatus.textContent = "無法開啟資料夾選擇視窗";
    settingsStatus.classList.add("error");
  }
}

document.querySelector("#browse-source").addEventListener("click", () => chooseAutomaticFolder(sourceFolder));
document.querySelector("#browse-output").addEventListener("click", () => chooseAutomaticFolder(outputFolder));
const runNowButton = document.querySelector("#run-now");

async function openDesktopFolder(folderPath, report) {
  if (!isDesktopApp || !window.pywebview?.api) {
    report("瀏覽器版受到安全限制，請從瀏覽器的下載紀錄開啟檔案位置", true);
    return;
  }
  if (folderPath === null) {
    report("請先選擇資料夾", true);
    return;
  }
  try {
    const result = await window.pywebview.api.open_folder(folderPath || "");
    if (!result?.success) {
      report(result?.error || "無法開啟資料夾", true);
      return;
    }
    report(`已開啟：${result.path}`, false);
  } catch (error) {
    console.error(error);
    report("無法呼叫 Windows 檔案總管", true);
  }
}

document.querySelector("#open-manual-output").addEventListener("click", () => {
  openDesktopFolder("", (message, isError) => setStatus(message, isError));
});
document.querySelector("#open-auto-source").addEventListener("click", () => {
  openDesktopFolder(sourceFolder.value || null, (message, isError) => setAutoStatus(message, isError ? "error" : "success"));
});
document.querySelector("#open-auto-output").addEventListener("click", () => {
  openDesktopFolder(outputFolder.value || null, (message, isError) => setAutoStatus(message, isError ? "error" : "success"));
});

function setAutoStatus(message, type = "success") {
  const autoStatus = document.querySelector("#auto-status");
  autoStatus.className = `status-line${type === "muted" ? " muted" : type === "error" ? " error" : ""}`;
  const marker = document.createElement("span");
  marker.textContent = type === "error" ? "!" : type === "muted" ? "·" : "●";
  autoStatus.replaceChildren(marker, document.createTextNode(message));
}

const autoJobSection = document.querySelector("#auto-job-section");
const autoJobList = document.querySelector("#auto-job-list");
const autoJobSummary = document.querySelector("#auto-job-summary");
const autoJobProgress = document.querySelector("#auto-job-progress");

function createAutoJobCard(group, index, namingModeValue) {
  const card = document.createElement("article");
  card.className = "auto-job-card";
  card.dataset.jobIndex = String(index);

  const thumbnail = document.createElement("div");
  thumbnail.className = "auto-job-thumb";
  if (group.thumbnail) {
    const image = document.createElement("img");
    image.src = group.thumbnail;
    image.alt = "";
    thumbnail.append(image);
  } else {
    thumbnail.textContent = "PDF";
  }
  const spinner = document.createElement("span");
  spinner.className = "auto-job-spinner";
  thumbnail.append(spinner);

  const info = document.createElement("div");
  info.className = "auto-job-info";
  const name = document.createElement("strong");
  name.className = "auto-job-name";
  name.textContent = namingModeValue === "system" ? `${group.name}（系統命名）` : `${group.name}.pdf`;
  const meta = document.createElement("span");
  meta.className = "auto-job-meta";
  meta.textContent = `${group.imageCount} 張圖片・${group.path}`;
  const state = document.createElement("span");
  state.className = "auto-job-state";
  state.textContent = "等待轉換";
  info.append(name, meta, state);
  card.append(thumbnail, info);
  return card;
}

function setAutoJobState(index, state, message, result) {
  const card = autoJobList.querySelector(`[data-job-index="${index}"]`);
  if (!card) return;
  card.classList.remove("is-running", "is-complete", "is-error");
  if (state) card.classList.add(`is-${state}`);
  card.querySelector(".auto-job-state").textContent = message;
  if (result?.name) card.querySelector(".auto-job-name").textContent = result.name;
  if (result?.pages) card.querySelector(".auto-job-meta").textContent = `${result.pages} 頁・${result.path}`;
  if (state === "running") card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderAutoJobs(groups, namingModeValue) {
  autoJobList.replaceChildren(...groups.map((group, index) => createAutoJobCard(group, index, namingModeValue)));
  autoJobSummary.textContent = `${groups.length} 個資料夾・${groups.reduce((sum, group) => sum + group.imageCount, 0)} 張圖片`;
  autoJobProgress.textContent = `0 / ${groups.length}`;
  autoJobSection.hidden = false;
}

async function runAutoConversion(isStartup = false) {
  if (!sourceFolder.value || !outputFolder.value) {
    setAutoStatus("請先完成來源與輸出資料夾設定", "error");
    return;
  }
  if (!isDesktopApp || !window.pywebview?.api) {
    showDesktopOnlyNotice();
    return;
  }

  runNowButton.disabled = true;
  runNowButton.textContent = "正在掃描…";
  setAutoStatus(`${isStartup ? "啟動自動執行：" : ""}正在掃描來源資料夾…`);
  try {
    const settings = collectSettings();
    await saveSettings();
    const scan = await window.pywebview.api.scan_auto_conversion(settings);
    if (!scan?.success) {
      autoJobSection.hidden = true;
      setAutoStatus(scan?.error || "掃描來源資料夾失敗", "error");
      return;
    }

    renderAutoJobs(scan.groups, settings.namingMode);
    runNowButton.textContent = `正在轉換 0 / ${scan.groups.length}`;
    let completed = 0;
    let failed = 0;
    let lastFinishedAt = "";
    for (let index = 0; index < scan.groups.length; index += 1) {
      const group = scan.groups[index];
      setAutoJobState(index, "running", `${group.name} PDF 產生中…`);
      setAutoStatus(`正在產生第 ${index + 1} / ${scan.groups.length} 份 PDF：${group.name}`);
      runNowButton.textContent = `正在轉換 ${index + 1} / ${scan.groups.length}`;
      await new Promise((resolve) => setTimeout(resolve, 40));
      const result = await window.pywebview.api.run_auto_group(settings, group);
      if (result?.success) {
        completed += 1;
        lastFinishedAt = result.finishedAt;
        setAutoJobState(index, "complete", `轉換完成・${result.pages} 頁`, result);
      } else {
        failed += 1;
        setAutoJobState(index, "error", result?.error || "轉換失敗");
      }
      autoJobProgress.textContent = `${completed + failed} / ${scan.groups.length}`;
    }

    const lastRun = document.querySelector("#last-run");
    lastRun.className = `status-line${failed ? " error" : ""}`;
    const marker = document.createElement("span");
    marker.textContent = failed ? "!" : "●";
    lastRun.replaceChildren(marker, document.createTextNode(`完成於 ${lastFinishedAt || new Date().toLocaleString()}`));
    if (failed) {
      setAutoStatus(`完成 ${completed} 份 PDF，${failed} 份轉換失敗；請查看任務卡片`, "error");
    } else {
      setAutoStatus(`全部完成：已從 ${scan.groups.length} 個資料夾建立 ${completed} 份 PDF`);
    }
  } catch (error) {
    console.error(error);
    setAutoStatus(`自動轉換失敗：${error instanceof Error ? error.message : "未知錯誤"}`, "error");
  } finally {
    runNowButton.disabled = false;
    runNowButton.textContent = "開始自動轉換";
  }
}

runNowButton.addEventListener("click", () => runAutoConversion(false));

document.querySelector("#minimize-window").addEventListener("click", () => {
  if (window.pywebview?.api) window.pywebview.api.minimize();
  else setStatus("瀏覽器頁面無法由網站最小化");
});
document.querySelector("#maximize-window").addEventListener("click", () => {
  if (window.pywebview?.api) window.pywebview.api.toggle_maximize();
  else if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});
document.querySelector("#close-window").addEventListener("click", () => {
  if (window.pywebview?.api) window.pywebview.api.close();
  else window.close();
});

loadSettings();
renderImages();
