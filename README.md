# AutoPDF 圖片轉 PDF 小幫手

AutoPDF 是一套在本機處理圖片的 PDF 轉換工具，提供純網頁版與 Windows 桌面版。圖片不會上傳到伺服器。

- 線上版：<https://yozuwork.github.io/AutoPDF/>
- GitHub：<https://github.com/yozuwork/AutoPDF>

## 主要功能

### 手動轉換

- 支援 JPG、PNG、WebP 與 ZIP。
- 可拖曳圖片、單一資料夾或多個資料夾，也可以用「選擇資料夾」挑選資料夾（瀏覽器一次只能選一個，可在彈出視窗按「再加入資料夾」連續加入）。
- 選擇的資料夾若含有子資料夾，每個子資料夾視為一個資料夾。
- 偵測到兩個以上資料夾時會跳出視窗詢問：每個資料夾各產生一份 PDF，或依序合併成一份 PDF（可自訂檔名）。
- 每份 PDF 會建立一張任務卡片。
- 可拖曳調整圖片順序、移除圖片及預覽縮圖。
- 支援依圖片比例或 A4 頁面，以及不同圖片邊距。
- 支援資料夾名稱與日期序號命名。

### Windows 自動轉換

- 選擇來源資料夾與 PDF 輸出資料夾。
- 來源下的每個子資料夾會分別產生一份 PDF。
- 顯示任務卡片、縮圖、Loading 動畫與成功／失敗狀態。
- 可在程式啟動時自動執行一次。
- 可在完成後移動原始圖片。
- 可直接開啟來源資料夾與目的資料夾。

> 瀏覽器基於安全限制，不能直接監看或任意讀寫電腦資料夾，因此「自動轉換」只提供給 Windows 應用程式版本。線上版仍可使用完整的手動轉換功能。

## 使用線上版

1. 開啟 <https://yozuwork.github.io/AutoPDF/>。
2. 將圖片、資料夾或 ZIP 拖曳到上傳區。
3. 確認每張 PDF 卡片中的圖片與排列順序。
4. 在「設定」調整頁面尺寸、邊距及命名方式。
5. 按下「合併成 PDF」下載檔案。

## 使用 Windows 桌面版

### 直接執行 EXE

執行 `dist/ImageToPDF.exe`。如果尚未建立 EXE，請依照下方步驟自行封裝。

### 使用 Python 啟動

需要 Python 3.11 以上版本：

```powershell
python -m pip install -r requirements.txt
python app.py
```

## 本機開發

需要 Node.js 18 以上版本。

```powershell
npm install
npm run dev
```

啟動後開啟終端機顯示的本機網址。`npm run dev` 是網頁開發模式，因此自動轉換及開啟 Windows 資料夾等桌面功能不會啟用。

## 建立 Windows EXE

需要 Windows 與 Python 3.11 以上版本：

```powershell
npm run cloc
```

此指令會安裝必要的 Python 打包套件，並將結果輸出至：

```text
dist/ImageToPDF.exe
```

`npm run build:exe` 與 `npm run cloc` 功能相同。

## 部署線上版

第一次執行前先安裝 Node.js 套件：

```powershell
npm install
```

接著執行：

```powershell
npm run deploy
```

部署流程會：

1. 執行 `npm run build:web`。
2. 將網頁必要檔案整理至 `web-dist`。
3. 將 `web-dist` 發布到 GitHub 的 `gh-pages` 分支。

若 GitHub Pages 尚未啟用，請到 GitHub 儲存庫的 **Settings → Pages**，將來源設為 **Deploy from a branch**，分支選擇 `gh-pages` 與 `/ (root)`。

## 專案結構

```text
app.js                 網頁互動與手動轉換功能
app.py                 Windows 桌面視窗與本機 API
auto_converter.py      桌面版自動 PDF 轉換引擎
index.html             頁面結構
style.css              共用介面樣式
pdf-cards.css          手動 PDF 卡片樣式
auto-cards.css         自動轉換任務卡片樣式
dev-server.js          本機開發伺服器
scripts/build-web.js   線上版建置腳本
scripts/build-exe.js   Windows EXE 封裝腳本
tests/                 Python 自動化測試
```

## 測試

```powershell
python -m unittest tests.test_auto_converter -v
```
