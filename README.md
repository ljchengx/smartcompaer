# smartcompaer

静态页 **AI 阅卷可视化**：支持填空题（`ai_questions` / `ai_mode=1`）与选择题（`questions`）。在浏览器中选择本地考试目录 JSON 即可查看，无需后端。

## 线上地址

- **GitHub Pages（随 `main` 自动更新）**：<https://ljchengx.github.io/smartcompaer/>
- **Vercel（需项目已连 Git 并部署成功）**：<https://smartcompaer.vercel.app>

若 Vercel 仍显示旧版，见 [docs/vercel-manual.md](docs/vercel-manual.md)（Deploy Hook / GitHub Actions / CLI）。  
推荐在 GitHub 配置 `VERCEL_TOKEN` 等 Secret 后，用 **Actions → Deploy Vercel** 部署，不依赖 Vercel 网页拉 Git。

## 本地预览

直接用静态服务器打开根目录（需 HTTPS 或 localhost，文件夹选择 API 才可用），例如：

```bash
npx --yes serve .
```

## 部署（Vercel 自动）

仓库已连接 Vercel：**推送到 `main` 即自动部署**。

构建流程：

1. `npm run build` → `scripts/prepare-deploy.js` 按 Git 提交 SHA 重写 `index.html` 里 `app.js` / `app.css` 的 `?v=`，避免 CDN/浏览器缓存旧资源。
2. 根目录静态文件发布；`vercel.json` 对 `index.html` 禁长期缓存，对 `/assets/*` 长期缓存（配合版本 query）。

本地模拟部署构建：

```bash
npm run prepare:local
```

## 数据目录

- **选择题**：如 `…/202610/…/detect/*.json`（字段 `questions`）。
- **填空题**：学生 JSON 内 `ai_questions` 且 `ai_mode === 1`。

页面上先选题型，再「选择文件夹」（支持多任务子目录）。

## 可选：离线打包

```bash
python build_data.py
```

会在 `data/exam.js` 生成 `window.EXAM_DATA`（当前页面默认仍走文件夹读取，不依赖该文件）。
