# 部署：单个 Cloudflare Worker、EdgeOne Pages 与自有服务器

本项目采用同源部署：浏览器请求 `/api/config`、`/api/rates`、`/api/ai`。编辑、预览、草稿与导出仍在浏览器执行；普通单据不会上传。

## 1. 共用后端

- `cloud-functions/_lib/api.js`：共享业务处理、输入/输出校验、汇率缓存与 AI 保护。
- `cloud-functions/api/[[path]].js`：EdgeOne Node.js 云函数入口，导出 `onRequest`，不监听端口。
- `cloudflare/worker.js`：唯一 Cloudflare Worker 入口；`cloudflare/api.js` 将运行时变量传给共享 API。
- `server/app.mjs`：Express 适配器；生产模式只从 `dist/` 提供静态文件，不暴露项目目录。
- `server.mjs`：自有服务器/本地服务的启动入口。

各部署方式共用协议，不需要修改前端 API 地址。暂不支持前后端跨域分开部署。

## Cloudflare：一个 Worker 部署全部功能

仅需一个 Worker。根目录 `wrangler.jsonc` 指定 `cloudflare/worker.js` 和静态输出 `dist/`，`ASSETS` 是该部署内置的静态资源绑定，**不是另一个 Worker**。无需 Cloudflare Pages、Service Binding、KV、D1 或 Durable Objects；业务资料仍保存在用户浏览器。

### 命令行发布

使用 Node.js 22+，在项目根目录执行（Windows 使用 `npm.cmd` / `npx.cmd`）：

```sh
npm ci
npx wrangler login
npm run deploy:cloudflare
```

`deploy:cloudflare` 先构建，再用唯一的 `wrangler.jsonc` 发布静态资源及 API。默认 Worker 名为 `tradekit-lite`，如需改名请改该配置的 `name`；不要另建前端或 API Worker。首次发布可以不配置 AI：制单、导出、本地规则解析及默认汇率源照常可用。

如需在线 AI，在**同一个 Worker** 的 Settings → Variables and Secrets 中添加两个 Secret，或执行以下交互命令（不要将真实值写入命令、仓库或构建变量）：

```sh
npx wrangler secret put AI_API_KEY
npx wrangler secret put AI_ACCESS_TOKEN
```

`AI_ACCESS_TOKEN` 使用独立随机口令，不是供应商密钥；必须满足下表规则，否则 AI 保持关闭。其他可选变量（`AI_BASE_URL`、`AI_MODEL`、`AI_RATE_LIMIT` 等）使用该 Worker 的运行时变量。推荐在同一 Worker 的 Settings → Variables and Secrets 维护：密钥和访问口令设为 Secret，地址、模型名及非敏感参数可设为普通变量；需要隐藏自定义网关地址时，也可设为 Secret。

`wrangler.jsonc` 已设置 `keep_vars: true`，常规 `wrangler deploy` 会保留控制台中的普通变量；Secret 原本就不会因未写入配置文件而清除。不要在配置文件 `vars` 中重复维护同名变量，否则配置值仍可能覆盖控制台值。保持 Worker 名称和目标环境一致；更名、删除重建或换环境不会自动迁移这些配置。不要用 `VITE_`、`process.env` 或 `.env` 构建注入密钥，也不要将任何真实密钥写入开源仓库。

### Cloudflare 仓库自动部署

选择 **Workers** 项目，不是 Pages，通过 Workers Builds 连接自己 Fork 或复制的仓库，选择包含所需版本源码的部署分支；仓库根目录为项目根目录，Node.js 使用 22 或更高。安装 `npm ci`，构建命令设为 `npm run typecheck && npm test && npm run build`，部署命令设为 `npx wrangler deploy`。Worker 名与 `wrangler.jsonc` 的 `name` 保持一致；不要选择仅静态上传 `dist/` 的模式，否则没有 API。

所选部署分支更新后，平台检查、构建并更新同一个 Worker 的静态资源与 API。构建变量设置自己的 `SITE_URL`，预览环境设置 `SITE_INDEXABLE=false`；这些变量与 Worker 的模型 Secret 分开。运行时 Secret 和普通变量仍在 Worker Settings 中配置，不设为前端构建变量。自动部署与项目维护者的 GitHub Release 发布流程相互独立。

部署分支须包含完整源码。在 Worker 的 Domains & Routes 绑定自己的域名，与 `SITE_URL` 保持一致，见[站点配置](#站点地址与-seo)。

### 本地验证与路由

```sh
npm run build
npm run check:cloudflare
npm run test:cloudflare
npm run dev:cloudflare
```

- `check:cloudflare` 仅 dry-run 打包；`test:cloudflare` 使用本地 workerd、合成变量和模拟上游验证同一份 Worker 与静态目录，不发布、不调用真实 AI/汇率。
- `dev:cloudflare` 服务构建后的 `dist/`，前端修改后需重新构建。若需本地 AI，可参考 `.dev.vars.example` 创建未提交的 `.dev.vars`，保留已有文件；Wrangler 本地模式也要求合法口令，不允许匿名 AI。
- `/api`、`/api/*` 优先进入 Worker；未知接口返回 JSON 404，不会变成首页 HTML。其余请求优先取静态资源；当前应用用 hash 导航，不需要 SPA fallback，未知资源返回 404。
- `nodejs_compat` 用于共享 API 的 `node:crypto` / `node:buffer`；不要删除兼容标记。`public/_headers` 随构建提供静态安全响应头，带 hash 的 `/assets/*` 长缓存，首页要求重新校验；API 单独设置安全响应头和 `no-store`。
- 平台 WAF、限流、供应商预算仍须单独配置；一个已部署 Worker 可有多个运行实例，内存缓存及 AI 限制不因此变为全局配额。此配置不会创建额外防护服务。

官方参考：[Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/binding/)、[Node.js 兼容](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)、[Secret](https://developers.cloudflare.com/workers/configuration/secrets/)。

## 站点地址与 SEO

站点变量在构建时读取，与服务端密钥分开配置：

| 变量 | 规则 |
| --- | --- |
| `SITE_URL` | 自己的 HTTPS 来源，如 `https://tools.example.com`，不含路径、查询或凭据 |
| `SITE_INDEXABLE` | `true` / `false`；配置正式地址后默认允许索引，预览环境设 `false` |

未配置地址时不输出 canonical、OG 绝对地址或 JSON-LD，使用 noindex、禁止抓取的 robots 和空站点地图。配置地址但禁止索引时仍保留 canonical 与分享信息；开发服务器始终禁止索引。

`index.html` 提供首页元数据、结构化数据和加载首屏；禁用 JavaScript 时显示产品介绍。`site/` 提供无需脚本的 `/guide/`、`guide.md`、`llms.txt` 和 `llms-full.txt` 模板，`scripts/site-seo.ts` 按构建配置生成到 `dist/`。完整机器可读说明来自 `site/guide.md`；修改功能时同步静态 HTML 说明，避免两份内容矛盾。

sitemap 仅列首页和使用说明，不列 API、hash 单据或业务资料；robots 不是访问控制。社交分享图源文件与 PNG 位于 `public/`。`llms.txt` 不保证搜索收录、模型引用或排名。

构建后运行 `npm run test:seo`；实际发布后核对 canonical、分享预览、robots、sitemap 和说明链接均指向自己的域名。模型 Secret 不得使用 `VITE_` 或 `SITE_` 前缀。

## 2. EdgeOne Pages

1. 将项目源码导入 Pages，项目根目录设为仓库根目录，**不要仅上传 `dist/`**，否则不会部署云函数。
2. 仓库中的 `edgeone.json` 指定：`npm ci`、`npm run build`、静态输出 `dist`、构建 Node `22.11.0`、Node 云函数最长执行 60 秒。
   构建变量配置自己的 `SITE_URL`，预览环境配置 `SITE_INDEXABLE=false`，详见 [站点地址与 SEO](#站点地址与-seo)。
3. 在项目环境变量设置中配置下表中的服务端变量。**不要使用 `VITE_` 前缀，不要提交 `.env`，不要把密钥写进 `edgeone.json`。**
4. 分别检查生产/预览环境的变量作用域，修改后重新部署。若不希望预览环境可调用 AI，不要给预览环境模型凭证。
5. 绑定自定义域名；Cloudflare DNS 的 CNAME 指向 EdgeOne 给出的目标，使用灰云（仅 DNS）。
6. 配置安全策略，访问 `/api/config` 确认得到 JSON；错误 API 路径应返回 JSON 404，不是首页 HTML。

`AI_API_KEY` 未设置，或 `AI_ACCESS_TOKEN` 不合法时，线上 AI 默认关闭。本地规则解析、编辑与导出仍可使用。

函数自身只负责保护和友好错误提示，**不会通过 `edgeone.json` 自动创建防机器人或限流规则**。实际防护功能、额度与规则入口，以当前账号及控制台为准。

官方参考：[Node.js 云函数](https://pages.edgeone.ai/document/node-functions)、[配置文件](https://pages.edgeone.ai/document/edgeone-json)、[限制和安全配额](https://pages.edgeone.ai/document/limits-and-quotas)。

## 3. 自有服务器

需要 Node.js 22+。以下命令在项目根目录执行，Windows 将 `npm` 写成 `npm.cmd`。

```sh
npm ci
npm run build
npm run test:deployment
# 根据 .env.example 创建 .env 并配置服务端变量
npm start
```

`npm start` 显式启用生产模式，即便绑定在 `127.0.0.1`，也不会允许匿名 AI 调用。默认端口 `3001`、地址 `127.0.0.1`。部署时应使用 systemd/PM2/容器等进程管理方式，而不是依赖交互终端常驻。

推荐 HTTPS 反向代理到 Node，由 Node 提供前端及 API。设置：

```dotenv
HOST=127.0.0.1
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://tools.example.com
AI_API_KEY=供应商模型密钥
AI_ACCESS_TOKEN=独立生成的随机访问口令
```

`ALLOWED_ORIGINS` 是逗号分隔的完整来源（含协议及非默认端口，不含末尾 `/`）。代理到内部 HTTP 时，浏览器的 HTTPS Origin 与内部请求来源不同，必须填正确的公开来源。它只是来源校验，**不能替代访问口令，也不会开启跨域 CORS**。

若运行在容器中，可设 `HOST=0.0.0.0`，但应通过容器网络/防火墙限制后端直接暴露。

### Nginx 示例

替换域名及 TLS 证书路径。`limit_req_zone` 放在 `http` 块；`server` 放在其内部。认证口令通过 Authorization 转发，不得在代理日志中记录该请求头或请求正文。

```nginx
# http 块内
limit_req_zone $binary_remote_addr zone=tradekit_ai:10m rate=5r/m;

server {
    listen 443 ssl;
    server_name tools.example.com;
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    client_max_body_size 1m;

    location = /api/ai {
        limit_req zone=tradekit_ai burst=2 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_read_timeout 65s;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_read_timeout 65s;
    }
}
```

该示例是单台反向代理按 IP 限流，不是多机共享配额；若 Nginx 前还有 CDN，需正确配置仅信任该 CDN 的真实客户端 IP，不能无条件信任访客传入的 IP 请求头。使用 CDN 时，对 `/api/*` 禁用缓存。配置 HTTP→HTTPS 跳转及 TLS 后再交付使用。

## 4. 服务端环境变量

| 变量 | 默认值 / 规则 |
| --- | --- |
| `HOST` / `PORT` | 独立 Node 监听地址/端口，默认 `127.0.0.1:3001`；云函数与 Worker 忽略 |
| `ALLOWED_ORIGINS` | 默认同源；反向代理场景填写公开 HTTPS 来源，可填多个 |
| `AI_BASE_URL` | 默认 `https://api.openai.com/v1`，需兼容 Chat Completions 与 JSON 模式 |
| `AI_MODEL` | 默认 `gpt-4o-mini` |
| `AI_API_KEY` | 仅后端读取的供应商模型密钥 |
| `AI_ACCESS_TOKEN` | 线上必填：32–512 个非空格可打印 ASCII 字符，建议随机生成 32 字节十六进制值 |
| `AI_RATE_LIMIT` | 默认每实例每分钟最多 10 次 AI 请求，含失败调用；有效范围 1–1000 |
| `AI_MAX_CONCURRENT` | 默认每实例最多 2 个并发模型请求，有效范围 1–20 |
| `AI_MAX_TOKENS` | 默认每次最多 2048 输出 tokens，使用 `max_tokens`；范围 128–8192，模型须支持该参数 |
| `EXCHANGE_URL` | 默认公开汇率源；自定义源需返回合法数值 `rates`，需含 USD/CNY/EUR/GBP/AED |

可生成随机访问口令：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

不要把真实口令发到公开文档或代码中。口令由管理员私下提供，用户在 AI 区域输入；仅保留在当前页面内存，刷新后清除，不进入草稿或 localStorage。口令是简单共享访问控制，**不是用户账号体系**；适合自用/小范围使用，丢失后应立即轮换并重新部署。

开发模式 `npm run server` 只在监听地址为本机、未配置访问口令且 `NODE_ENV` 非 production 时允许无口令 AI。**绝不能将这个开发模式通过隧道/反向代理暴露到公网**；线上必须运行 `npm start`。

## 5. 缓存、限流与安全验证

- 汇率使用每实例一小时内存缓存，同实例并发请求合并；冷启动或多实例会分别请求上游，不保证全局共享缓存。API 响应使用 `no-store`，避免认证配置和错误被 CDN 缓存。
- AI 输入不超过 20,000 字，请求/上游响应不超过 1 MiB；模型结果限制字段类型/长度与 200 行，忽略不支持字段。数值与业务准确性仍需人工核对。
- 模型请求超时 45 秒；云函数配置 60 秒，浏览器请求超时 60 秒。汇率上游超时 12 秒。
- 应用内调用频次/并发限制**仅作用于当前实例**，重启会重置，EdgeOne/Cloudflare 多实例不会共享。它们不是每用户配额、总费用上限或可靠的分布式限流。
- 公开部署必须同时配置 Cloudflare/EdgeOne/Nginx 的 `/api/ai` 限流和供应商预算/告警。大范围开放前应实现用户身份、共享存储的配额和全局熔断，不能直接公开共享口令。
- 防机器人能降低滥用，但不能替代鉴权。避免对所有 API 请求强制返回整页人机验证，尤其是 POST；可在访问页面时完成挑战，异常 API 请求阻断/限流，并验证正常浏览器调用能通过。
- 前端检查响应 Content-Type；遇到 HTML 挑战页或错误 SPA 路由，会给出验证/路由提示，而不是把 HTML 当 JSON 解析。这里只处理错误，不自动绕过验证、不保证刷新首页能解决每种挑战策略。
- 错误响应不透传上游详情，防止意外暴露密钥、供应商响应或业务正文。

## 6. 发布验收

构建与本地模拟检查见[测试说明](TESTING.md)。发布后人工确认：

1. 首页、资源、导出和说明页正常；私有文件不可读取，SEO 使用自己的域名。
2. `/api/config` 不包含密钥；线上只配模型密钥、未配合法口令时 AI 关闭。错误口令返回 401，不调用上游。
3. 正确口令、用户同意及候选确认流程正常；真实供应商、模型参数、超时和平台安全挑战已核对。
4. API 不缓存，平台执行限制、限流与供应商预算告警已生效。本地 workerd/模拟测试不能替代真实发布验收。

## 7. 浏览器资料与升级

- 单据、目录、图片和设置当前存于浏览器 IndexedDB，不在 Node/云函数磁盘上。部署服务不等于云端保存业务资料。
- 升级前提醒用户下载全部资料 JSON；新版首次启动迁移旧 localStorage，提交失败不删除旧内容，升级期间避免旧版/新版同时编辑。
- **多单据版本首次初始化会清空旧版单据及其恢复/损坏副本，不迁移旧单据**；独立卖方、买方、产品目录和设置保留。清空仅在 `documents` 集合尚未初始化时执行一次，已有集合损坏时拒绝覆盖，不自动重置。发布前须明确告知；需要留存旧单据的用户应先备份，之后可主动导入。
- 沿用既有协议、域名和端口。更换域名、HTTP→HTTPS 或端口都会改变浏览器 origin，旧资料不会自动跨地址迁移；需要用户在原地址备份后于新地址确认恢复。
- 反向代理示例和浏览器测试不得通过关闭生产安全响应头、清空用户数据或暴露开发服务绕过问题。
- 发布前同步 [开发指南](DEVELOPMENT.md)、根目录 [README](../README.md) 及 [验证记录](TESTING.md)；模拟本地通过不代替真实平台与供应商验收。
