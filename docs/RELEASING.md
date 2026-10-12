# 开发与发布

仓库目标：[liaobin98/tradekit-lite](https://github.com/liaobin98/tradekit-lite)。项目约定 **main 开发线**、**release 发布线**，release 只接收本次准备发布的内容。分支、默认分支、保护规则和工作流是否已在远端配置，必须单独核对；本文描述约定与操作流程，不是远端设置完成的证明。

功能须人工验收后再逐功能提交，使用中文提交说明；没有明确要求不推送。以下命令描述发布流程，不是自动执行授权。

## 提交前准备

在项目根目录执行以下离线检查，不会暂存、提交、拉取或推送：

```powershell
git status --short --branch
git diff --check
npm.cmd run check:repository
npm.cmd run typecheck
npm.cmd test
npm.cmd run release:check -- --if-present
npm.cmd run build
```

- `check:repository` 检查工作区中已跟踪和未忽略的新文件，跳过已删除文件；核对环境文件/产物路径、常见凭证格式、冲突标记、Markdown 本地文件链接和 npm 锁文件根配置。不会访问链接或打印疑似凭证原值；不检查链接锚点、远端状态或所有凭证格式，仍须人工审查业务资料与敏感信息。
- TypeScript 同时检查未使用的局部变量、导入和参数。构建生成的 `dist/`、公共许可声明、测试截图和本地配置不提交；保留源码、测试、锁文件、项目/UI 许可证和许可报告。
- 未准备版本说明时，`release:check -- --if-present` 可以跳过发布清单；这表示尚未准备发布，不是正式版本验收通过。本地浏览器成绩只记录实际执行的专项，见 [TESTING.md](TESTING.md)。
- 先核对 `git diff` 与新增文件，再按逻辑改动安排提交；不要用提交前整理顺带清空业务资料、删除设计依据或重写现有历史。
- `git status` 的 ahead/behind 只依据本地缓存。提交和推送前核对最新远端状态；历史分叉时先检查差异，不用强推覆盖其他人的工作。
- 提交、推送和发布前核对目标分支、变更内容与验证结果。

## 分支分工

| 分支 | 用途 | 合入方式 |
| --- | --- | --- |
| `main` | 日常开发、最新提交、功能与修复积累 | 人工验收后按功能提交；推送或 PR 须明确授权 |
| `release` | 已验证的发布基线 | 约定通过 PR 和 `validate` 检查，禁止直接推送、强推和删除 |
| `rc/vX.Y.Z` | 从 release 创建的单次发布候选 | 只 `cherry-pick -x` 选定 main 提交，不整线合并 main |

main 与 release 的历史可以分开前进。发布合并不改变 main 的开发状态；发布说明、版本整理或发布分支上的必要修复，可之后用单独 PR 同步回 main，核对 diff，避免覆盖尚未发布的开发内容。两个长期分支均禁止强推和删除。候选分支使用 `rc/` 前缀，是因为 Git 无法同时建立 `release` 与 `release/v版本`。

## 日常开发

```powershell
git switch main
git pull --ff-only
# 修改、验证并完成人工验收后，按功能整理提交
git add <文件>
git commit -m "fix: 修复具体问题"
# 明确要求推送后，再执行 git push
```

需要人工浏览器验证的改动，记录实际结果；CI 不会伪称已执行本地 CDP 浏览器回归。CI 自动做 npm 锁文件安装、类型检查、单元测试、发布清单核对和生产构建。

## 选择一个或多个提交发布

先提交开发内容，保持工作区干净。更新说明草稿放在仓库外，避免混入代码或影响工作区检查：

```powershell
Copy-Item docs/releases/TEMPLATE.md "$env:TEMP\tradekit-release-notes.md"
notepad "$env:TEMP\tradekit-release-notes.md"
git fetch origin
git log --oneline origin/release..origin/main

# 一个提交
npm.cmd run release:prepare -- --version 1.0.1 --commits abc1234 --notes "$env:TEMP\tradekit-release-notes.md"

# 或：多个提交，按开发时由旧到新的顺序排列
npm.cmd run release:prepare -- --version 1.0.1 --commits abc1234,def5678 --notes "$env:TEMP\tradekit-release-notes.md"
```

脚本会拉取远端历史，确认提交属于 main、未在 release 中发布且不是 merge commit；从 `origin/release` 创建候选分支，挑选指定提交，更新 `package.json` / `package-lock.json`、`CHANGELOG.md`，生成：

- `docs/releases/vX.Y.Z.md`：用户可读说明及所选开发提交链接。
- `docs/releases/vX.Y.Z.json`：版本、发布基线和完整开发 SHA 清单，供 CI 核对。

脚本**不会自动推送、合并、打标签或公开发布**，不使用强推或自动 reset。出现冲突时保留现场供人工检查，不能把“所有 main 提交一起合并”当作冲突解决办法。若需要依赖提交，应中止本次挑选、从正确候选重新准备，并把依赖加入发布清单。

检查与验证后：

```powershell
git diff origin/release...HEAD
npm.cmd run typecheck
npm.cmd test
npm.cmd run release:check
npm.cmd run build
git status
# 若构建重新生成了平台相关许可报告，核对后另行提交，不要丢弃未知改动
git push -u origin rc/v1.0.1
```

打开脚本给出的 GitHub 比较链接，创建 **base: release / compare: rc/v1.0.1** 的 PR。确认 diff 只包含本次选中变化、版本和说明，等待 `validate` 通过，再合并。建议 Rebase and merge；不需要其他人的强制审核，单人维护也可操作，但仍必须通过 CI。

### 首次发布

首版说明草稿见 [DRAFT-v1.0.0.md](releases/DRAFT-v1.0.0.md)，用于审阅，不是正式发布清单，也不会触发 Release。确定内容后复制到仓库外，作为下面命令的 `--notes` 输入。

如果本地与远程都尚无提交，先完成功能人工验收、配置提交作者，以当前完整源码建立中文说明的初始提交，再绑定并推送 `main`。初次快照无法还原不存在的历史；后续改动按功能分别提交。确认采用 main/release 发布流程后，从同一已验证提交建立并推送 `release`，再准备发布候选。不得凭空填写清单里的提交 SHA，也不需要强推。

准备第一次正式版本前，确认 `origin/release` 已存在且基线完整。首次发布可选择 release 的初始基线，不携带 main 后续开发改动：

```powershell
npm.cmd run release:prepare -- --initial --version 1.0.0 --notes "$env:TEMP\tradekit-release-notes.md"
```

`--initial` 只在尚无 `v*` 发布标签时可用，版本必须等于 release 的当前版本。之后按正常 PR 流程操作；后续版本必须递增。

## 在 GitHub 查看每次更新

发布 PR 合入 release 后，**Release** 工作流再次验证并生成 **草稿 Release**，包含：

- 已整理的新增、修复、兼容/迁移、验证与已知限制说明。
- 本次挑选的每个 main 提交链接及发布基线。
- 经验证的网页构建 ZIP（含 LICENSE 与第三方声明）、当次许可报告和提交清单。
- 公开发布后对应的版本标签与 GitHub 源码下载。

在 [GitHub Releases](https://github.com/liaobin98/tradekit-lite/releases) 核对草稿内容、第三方许可和产物后点击发布。也可进入 **Actions → Release → Run workflow**，务必选择 **release** 分支，勾选 `publish` 和已完成许可核对后执行。

默认不会自动公开发布，避免将 CI 构建成功误当作第三方许可已获合规确认。许可说明见 [LICENSING.md](LICENSING.md)。已公开的版本、标签和下载文件不覆盖；有变化使用新版本号。已有草稿绑定具体提交，release 后续前进时不会将旧草稿重新指向其他代码；应在 Releases 页面核对并发布原草稿，或准备新版本。

每个版本都可从 Releases 的说明、版本标签、所选 main 提交链接，以及仓库 `CHANGELOG.md` / `docs/releases/` 查到对应变化。

## 回滚与维护

- 代码回滚：从 release 创建修复 PR，revert 出问题的改动，准备新的补丁版本和说明；不重写旧标签。
- 数据回滚：依据该版本的兼容/迁移说明及用户 JSON 备份操作，不把回滚代码等同恢复业务数据。
- 远端配置约定：main 为默认分支，release 为 PR/CI 保护线，两个长期分支都禁止强推、删除；是否已启用以 GitHub 实际配置为准。
- 发布 ZIP 是 `dist/` 静态页面产物，不包含 API 服务、环境变量或凭证；EdgeOne/Cloudflare/自有服务器部署仍按 [DEPLOYMENT.md](DEPLOYMENT.md) 处理。
