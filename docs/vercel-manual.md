# Vercel 手动 / 可靠部署说明

## 为什么「重连 Git」仍看不到最新 commit？

常见原因：

1. **GitHub 侧 Vercel App 没授权本仓库**（只在 Vercel 里点 Connect 不够）  
   → [GitHub → Settings → Applications → Vercel → Configure](https://github.com/settings/installations)  
   → Repository access 选 **All** 或勾选 **smartcompaer** → Save  

2. **Production Branch 不是 `main`**  
   → Vercel 项目 **Settings → Git → Production Branch** 设为 `main`  

3. **连错了项目 / 账号**（个人 GitHub 与 Vercel Team 不一致）  

4. **Create Deployment 里应填引用名**  
   → **Deployments → Create Deployment**  
   → 输入 `main` 或完整 SHA（如 `9f3758f`），不要只指望列表里滚旧记录  

当前 GitHub `main` 最新提交可在仓库首页复制；本仓库曾卡在 `4001acd`（2025-09-22），而 GitHub Pages 已在 `9f3758f` 正常发布。

---

## 方法一：Deploy Hook（最快，不用配 GitHub Secret）

1. Vercel → 项目 **smartcompaer** → **Settings → Git → Deploy Hooks**  
2. **Create Hook**：Name 随意，Branch **`main`**  
3. 复制生成的 URL，在浏览器打开一次，或在 PowerShell：

```powershell
Invoke-WebRequest -Uri "粘贴你的_HOOK_URL" -Method POST
```

4. 回到 **Deployments** 看是否出现新构建（应用最新 `main`）。

---

## 方法二：网页 Redeploy（仅当已有对应 commit 的部署记录时）

**Deployments** → 某条部署 **⋯ → Redeploy**（取消 Use existing Build Cache）。

若列表里根本没有新 SHA，请用 **方法一** 或 **方法三**。

---

## 方法三：GitHub Actions 部署（推荐，push 即上线）

仓库已包含 workflow：`.github/workflows/vercel-deploy.yml`  

### 一次性配置三个 Secret

GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**

| Secret | 获取方式 |
|--------|----------|
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) → Create Token |
| `VERCEL_PROJECT_ID` | Vercel 项目 **Settings → General → Project ID** |
| `VERCEL_ORG_ID` | 同一页 **Team / Personal** 对应的 ID；或在本地 `vercel link` 后看 `.vercel/project.json` 里的 `orgId` |

### 触发部署

- 任意 push 到 `main`，或  
- **Actions → Deploy Vercel → Run workflow**

成功后 Production 域名会指向最新构建。

---

## 方法四：本机 CLI

```powershell
cd E:\AI\Code\smartcompaer
npx vercel login
npx vercel link
npm run build
npx vercel deploy --prod
```

---

## 临时访问新版（不依赖 Vercel）

<https://ljchengx.github.io/smartcompaer/>（随 `main` 自动更新）
