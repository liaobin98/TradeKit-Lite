# 许可与第三方声明

原创代码和文档采用 [MIT](../LICENSE)，版权署名为 `2026 TradeKit Lite contributors`。复制或分发时保留版权和许可全文；`package.json` 的 `private: true` 只防止误发布到 npm。

## 第三方许可

第三方依赖保持各自许可，不因项目采用 MIT 而被重新许可。本地适配的 shadcn/ui 声明保留在 [`src/components/ui/LICENSE`](../src/components/ui/LICENSE)。

依赖包含 MIT、Apache-2.0、ISC、BSD 及其他许可，完整包名、版本、许可文件和缺口统一以生成的 [LICENSE-REPORT.json](LICENSE-REPORT.json) 为准，不在本文重复维护依赖列表。lucide 声明需保留其 Feather 归属；双许可依赖的选用与原始声明均须核对。

## 生成声明

```sh
npm run licenses
```

`npm run build` 的 prebuild 也会执行该命令。脚本按 `package-lock.json` 读取已安装依赖的 LICENSE / LICENCE / COPYING / NOTICE，生成报告及 `public/LICENSE`、`public/THIRD-PARTY-NOTICES.txt`，构建时复制到 `dist/`。公共生成文件不提交，报告与源码许可证保留。

收集范围含开发依赖，不等同实际分发清单。缺少独立许可文件时 README 仅作核查材料，不视为完整授权；未安装的可选平台包也会标记。需要复核的数量随安装环境变化，以本次报告为准。

## 分发前核查

1. 检查 `reviewRequired`、实际分发依赖和素材来源，确认上游授权、补齐声明或替换缺失项；报告有缺口不等于已确认违规。
2. 按实际分发内容履行署名、声明及适用的源码提供义务，不只附项目 MIT 文本。
3. 静态站点携带 `dist/LICENSE` 和 `dist/THIRD-PARTY-NOTICES.txt`；另行分发服务端、依赖或素材时携带对应声明。
4. 依赖变化后重新生成报告；排除密钥、环境文件、业务资料和测试产物。

构建或声明收集通过，不代表第三方许可已全部人工核查。
