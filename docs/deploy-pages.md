# GitHub Pages 部署

## 首次部署前必做（否则会报 configure-pages Not Found）

Workflow 报错示例：

```
Error: Get Pages site failed. Please verify that the repository has Pages enabled
and configured to build using GitHub Actions
Error: HttpError: Not Found
```

**原因：** 仓库尚未在网页上启用 Pages，或 Source 不是「GitHub Actions」。

### 操作步骤（约 30 秒）

1. 打开 **https://github.com/jk9988610/Conquer-the-Three-Kingdoms/settings/pages**
2. **Build and deployment → Source** 下拉框选 **GitHub Actions**（不要选 Deploy from a branch）
3. 若页面提示需先启用 Pages，按提示确认启用
4. 打开 **https://github.com/jk9988610/Conquer-the-Three-Kingdoms/actions**
5. 进入失败的 **Deploy to GitHub Pages** → **Re-run all jobs**

### 可选：Workflow 权限

**Settings → Actions → General → Workflow permissions**

建议选 **Read and write permissions**（默认只读有时会影响部署）。

### 成功后

站点地址：**https://jk9988610.github.io/Conquer-the-Three-Kingdoms/**

首次上线可能需等待 1～5 分钟。
