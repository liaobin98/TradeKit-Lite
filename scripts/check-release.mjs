import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseVersion, validateManifest, validateNotes } from './release-lib.mjs';

try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  parseVersion(pkg.version);
  const tag = `v${pkg.version}`, manifestFile = `docs/releases/${tag}.json`, notesFile = `docs/releases/${tag}.md`;
  if (!existsSync(manifestFile) && !existsSync(notesFile) && process.argv.includes('--if-present')) {
    console.log('当前版本尚未准备发布清单，不创建标签或 Release。');
    if (process.argv.includes('--github-output')) appendFileSync(process.env.GITHUB_OUTPUT, 'enabled=false\n');
  } else {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw Error('package.json 与 package-lock.json 版本不一致。');
    const manifest = validateManifest(JSON.parse(readFileSync(manifestFile, 'utf8')), pkg.version);
    const notes = validateNotes(readFileSync(notesFile, 'utf8'));
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    if (!changelog.includes(`## [${pkg.version}]`) || !notes.startsWith(`# TradeKit Lite ${tag}\n`)) throw Error('版本与更新说明/CHANGELOG 不一致。');
    for (const commit of manifest.sourceCommits) {
      if (!notes.includes(`/commit/${commit.sha}`)) throw Error('更新说明缺少开发提交链接。');
    }
    for (const [sha, branch] of [[manifest.baseCommit, 'HEAD'], ...manifest.sourceCommits.map(commit => [commit.sha, 'origin/main'])]) {
      const result = spawnSync('git', ['merge-base', '--is-ancestor', sha, branch], { encoding: 'utf8' });
      if (result.status !== 0) throw Error(`发布清单引用的提交不在 ${branch} 中；请核对所选提交及拉取完整历史。`);
    }
    console.log(`发布清单通过：${tag}，${manifest.sourceCommits.length} 个 main 提交。`);
    if (process.argv.includes('--github-output')) appendFileSync(process.env.GITHUB_OUTPUT, `enabled=true\ntag=${tag}\n`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
