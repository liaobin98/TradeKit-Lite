export const repository = 'https://github.com/liaobin98/tradekit-lite';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[a-zA-Z-][a-zA-Z\d-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][a-zA-Z\d-]*))*))?$/;
export function parseVersion(version) {
  const match = typeof version === 'string' && versionPattern.exec(version);
  if (!match) throw Error('版本号须为 X.Y.Z 或 X.Y.Z-rc.1，不含 v 前缀、空格或路径。');
  return { core: match.slice(1, 4).map(BigInt), prerelease: match[4]?.split('.') ?? [] };
}
export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let index = 0; index < 3; index++) if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index], y = b.prerelease[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
export function validateNotes(notes) {
  if (typeof notes !== 'string' || notes.trim().length < 20 || !/^## /m.test(notes)) throw Error('请按模板整理非空的 Markdown 更新说明。');
  if (/\bTODO\b|待填写|请填写|\{\{[^}]*\}\}/i.test(notes)) throw Error('更新说明还包含模板占位内容，请先整理完成。');
  return notes.trim();
}
export function validateManifest(manifest, version) {
  parseVersion(version);
  if (!manifest || manifest.schemaVersion !== 1 || manifest.version !== version || manifest.sourceBranch !== 'main' || manifest.targetBranch !== 'release' ||
      !/^[a-f\d]{40}$/.test(manifest.baseCommit) || !Array.isArray(manifest.sourceCommits) || !manifest.sourceCommits.length ||
      !manifest.sourceCommits.every(item => item && /^[a-f\d]{40}$/.test(item.sha) && typeof item.subject === 'string') ||
      new Set(manifest.sourceCommits.map(item => item.sha)).size !== manifest.sourceCommits.length ||
      typeof manifest.initial !== 'boolean' || manifest.initial && (manifest.sourceCommits.length !== 1 || manifest.sourceCommits[0].sha !== manifest.baseCommit) ||
      !Number.isFinite(Date.parse(manifest.preparedAt))) throw Error('发布清单不完整，或版本/开发线/发布线/提交记录不一致。');
  return manifest;
}
export function releaseNotes(version, notes, commits, baseCommit) {
  parseVersion(version);
  return `# TradeKit Lite v${version}\n\n${validateNotes(notes)}\n\n## 包含的开发提交\n\n${commits.map(commit => `- [\`${commit.sha.slice(0, 7)}\`](${repository}/commit/${commit.sha}) — ${commit.subject.replace(/[\r\n]/g, ' ')}`).join('\n')}\n\n发布基线：[\`${baseCommit.slice(0, 7)}\`](${repository}/commit/${baseCommit})。仅包含上述选定提交及版本/更新说明整理，不自动包含其他 main 改动。\n`;
}
export function updateChangelog(current, version, notes, date) {
  const heading = `## [${version}]`;
  if (current.includes(heading)) throw Error('更新记录中已有同名版本，拒绝覆盖。');
  const marker = '## [Unreleased]';
  if (!current.includes(marker)) throw Error('CHANGELOG.md 缺少 Unreleased 节，未覆盖现有更新记录。');
  const position = current.indexOf('\n## ', current.indexOf(marker) + marker.length);
  const end = position < 0 ? current.length : position;
  return `${current.slice(0, end).trimEnd()}\n\n${heading} - ${date}\n\n${validateNotes(notes)}\n\n[完整发布说明](${repository}/releases/tag/v${version})\n${current.slice(end)}`;
}
