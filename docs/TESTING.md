# 测试与验收

在项目根目录执行；Windows 可使用 `npm.cmd`。业务规则见[开发指南](DEVELOPMENT.md)，本文维护有效入口与覆盖边界，不累积每次界面调整的验收日志。

## 常规检查

```sh
npm run check:repository
npm run typecheck
npm test
npm run build
npm run test:seo
npm run test:deployment
```

`npm test` 覆盖数值/字段/语言/输出、单据状态与定位、目录收录、存储/备份/恢复、API 和发布工具。`test:seo` 校验真实构建产物；`test:deployment` 使用模拟上游验证 Node 生产静态服务、API、安全头和私有文件隔离，两者均需先构建。

`check:repository` 是离线候选文件、常见凭证、冲突标记、Markdown 文件链接和 npm 锁文件检查，不检查所有凭证或链接锚点。CI 执行该检查、类型检查、单元测试、发布清单检查和构建；不自动执行下列浏览器专项。

Cloudflare 变更另运行 `npm run check:cloudflare` 与 `npm run test:cloudflare`。前者只打包，后者使用本地 workerd、合成变量和模拟上游，不发布或调用真实供应商。

## 保留的浏览器回归

| 命令 | 检查范围 | 前置条件 |
| --- | --- | --- |
| `npm run test:documents` | 多单据、保存/草稿、首页恢复、编号链接、打印不改状态、删除及备份数量 | 先构建；CDP Proxy |
| `npm run test:editing` | 新空白不入库、有内容自动保存、列表刷新、重复编号和离开保存 | CDP Proxy；脚本启动 Vite |
| `npm run test:navigation` | 菜单路由、展开/关闭、Escape、焦点恢复、共享备份弹窗、桌面切换 | 先构建；CDP Proxy |
| `npm run test:recovery` | 冲突救援下载/恢复双版本、损坏记录/容器恢复、错误可见、长表和长备注 PDF 内容完整性 | 先构建；独立 Edge/Chromium |

前三项连接 `http://localhost:3456` 的 CDP Proxy，需要本机已启动且已授权的服务；它不是项目自带依赖。未配置时不应把未执行写为通过。脚本只创建专用本地地址和标签页，不接收用户已有业务页。

`test:recovery` 不需要代理，默认启动 Windows Edge；其他安装位置可设置 `BROWSER_EXECUTABLE`。它使用临时浏览器资料目录、随机端口和模拟 API，实际 JSON/PDF 下载与报告保存在忽略的 `test-artifacts/project-audit/`，验证后关闭自建浏览器和服务。十模板的 PDF 分页检查保留，用于防止内容截断或丢失。

所有故障注入仅针对虚构资料。不要在业务 origin 运行测试、清空用户存储或调用真实打印机；旧的 localStorage 单据夹具不能当作当前应用的初始化方式。

## 测试保留原则

- 保留影响数据正确性、安全、兼容、导出内容和交互流程的回归。企业 Logo 的保存、删除和输出属于业务测试。
- 图标形状/尺寸、间距、配色、悬停和普通响应式排版按改动人工验收；一次性脚本完成后删除，不固化像素和 CSS 类名。
- 过时模型和已被当前回归替代的脚本直接删除，同步移除命令及引用，不维护一份“以后再适配”的入口清单。
- `test-artifacts/` 是可丢弃产物目录，不作为脚本库、业务备份或长期文档。截图生成不等于人工验收。

## 当前验证与边界

2026-10-12 清理后：36 个测试文件 / 668 项单元测试通过；类型检查（随构建）、生产构建、`test:seo`、`test:deployment` 和 `check:repository` 通过。精简后的 `test:recovery` 通过，含冲突双版本恢复、损坏隔离、100 行 PDF（6 页）、20 组模板/宽度及长备注内容检查。

`test:documents`、`test:editing`、`test:navigation` 本次未重跑，导航脚本完成语法检查；旧专项成绩不作为当前通过依据。

Cloudflare `test:cloudflare` 本地 workerd 验证通过。正式 Worker 已部署，HTTPS 首页、六类单据入口、参考汇率、使用说明、canonical/索引策略、站点地图及 API 配置/JSON 404 已实际检查；生产分支设为 `release`。在线 AI 尚未配置，不代表真实模型调用已验收。

提交前人工检查本次变更涉及的页面和导出文件。以下仍需专项或真实环境验收：

- 六类单据的真实手机、全键盘/读屏/对比度、打印设备及大量图片/多语言交付效果。
- 浏览器关闭、取消关闭、BFCache、实际配额耗尽、断电及强制终止；不能保证退出时异步保存成功。
- 真实 AI 供应商、EdgeOne/Node 公开部署、WAF、预算及多实例限流；本地模拟不代表这些场景的线上验收。
- 企业/产品目录的完整浏览器交互目前主要依赖单元测试与人工验收；旧目录专项已移除。
- 大分包和依赖许可人工复核。构建或许可证收集成功不代表审查完成。
