import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseVersion, compareVersions, validateNotes, releaseNotes, updateChangelog } from './release-lib.mjs';

export function prepareRelease({ version, commits = [], notesFile, initial = false, cwd = process.cwd() }) {
  parseVersion(version);
  if (!Array.isArray(commits) || (!initial && !commits.length) || (initial && commits.length) || !commits.every(sha => /^[a-f\d]{7,40}$/i.test(sha))) throw Error('请提供一个或多个提交 SHA；首发才可使用 --initial 且不传提交。');
  const notes = validateNotes(readFileSync(resolve(cwd, notesFile), 'utf8'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (result.error || result.status !== 0) throw Error(result.error?.message ?? `${args.join(' ')}\n${result.stderr || result.stdout}`);
    return result.stdout.trim();
  };
  if (git('rev-parse', '--show-toplevel').toLowerCase() !== resolve(cwd).replaceAll('\\', '/').toLowerCase()) throw Error('请在项目根目录运行。');
  if (git('status', '--porcelain')) throw Error('工作区有未提交内容。先提交开发改动；更新说明草稿请放到仓库外，再准备发布。');
  git('fetch', 'origin', '--prune');
  const base = git('rev-parse', 'origin/release'), source = git('rev-parse', 'origin/main');
  const mainPackage = JSON.parse(git('show', `${base}:package.json`));
  if (initial) {
    if (version !== mainPackage.version || git('tag', '--list', 'v*')) throw Error('首发只允许使用 release 的当前版本，且仓库尚无 v 开头的发布标签。');
    git('merge-base', '--is-ancestor', base, source);
  } else if (compareVersions(version, mainPackage.version) <= 0) throw Error(`版本号须高于发布线当前 ${mainPackage.version}。`);
  const tag = `v${version}`, branch = `rc/${tag}`;
  if (git('tag', '--list', tag) || git('branch', '--list', branch) || git('branch', '-r', '--list', `origin/${branch}`)) throw Error('同名标签或发布分支已存在，拒绝覆盖。');
  const selected = initial ? [{ sha: base, subject: git('show', '-s', '--format=%s', base) }] : commits.map(sha => ({ sha: git('rev-parse', '--verify', `${sha}^{commit}`), subject: git('show', '-s', '--format=%s', sha) }));
  if (new Set(selected.map(commit => commit.sha)).size !== selected.length) throw Error('不能重复挑选同一提交。');
  const available = new Map(git('cherry', base, source).split('\n').filter(Boolean).map(line => [line.slice(2), line[0]]));
  for (let index = 0; !initial && index < selected.length; index++) {
    const { sha } = selected[index];
    git('merge-base', '--is-ancestor', sha, source);
    if (git('rev-list', '--parents', '-n', '1', sha).split(' ').length > 2) throw Error('不直接挑选 merge commit。请选取已合入 main 的具体功能/修复提交。');
    if (available.get(sha) !== '+') throw Error(`提交 ${sha.slice(0, 7)} 已在发布线中（或存在等价补丁），无需重复发布。`);
    if (index) git('merge-base', '--is-ancestor', selected[index - 1].sha, sha);
  }
  git('switch', '-c', branch, base);
  try {
    // No shell interpolation, merge-parent guessing, force push or automatic reset.
    if (!initial) git('cherry-pick', '-x', ...selected.map(commit => commit.sha));
    const packageFile = resolve(cwd, 'package.json'), lockFile = resolve(cwd, 'package-lock.json');
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8')), lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    pkg.version = version; lock.version = version;
    if (!lock.packages?.['']) throw Error('package-lock.json 缺少根包条目。');
    lock.packages[''].version = version;
    const directory = resolve(cwd, 'docs/releases');
    if (existsSync(resolve(directory, `${tag}.md`)) || existsSync(resolve(directory, `${tag}.json`))) throw Error('发布说明已存在，拒绝覆盖。');
    const date = new Date();
    const manifest = { schemaVersion: 1, version, sourceBranch: 'main', targetBranch: 'release', initial, baseCommit: base, sourceCommits: selected, preparedAt: date.toISOString() };
    const changelog = updateChangelog(readFileSync(resolve(cwd, 'CHANGELOG.md'), 'utf8'), version, notes, date.toISOString().slice(0, 10));
    mkdirSync(directory, { recursive: true });
    writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n');
    writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
    writeFileSync(resolve(directory, `${tag}.md`), releaseNotes(version, notes, selected, base));
    writeFileSync(resolve(directory, `${tag}.json`), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(resolve(cwd, 'CHANGELOG.md'), changelog);
    git('add', '--', 'package.json', 'package-lock.json', 'CHANGELOG.md', `docs/releases/${tag}.md`, `docs/releases/${tag}.json`);
    git('commit', '-m', `chore(release): prepare ${tag}`);
    return { branch, tag, commits: selected, compareUrl: `https://github.com/liaobin98/tradekit-lite/compare/release...${branch}` };
  } catch (error) {
    throw Error(`${error.message}\n已停止在 ${branch}，没有推送或覆盖 main/release。若正在冲突中，请检查 git status；手动解决后 git cherry-pick --continue，或 git cherry-pick --abort 后重新准备。不会自动丢弃工作区内容。`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
      console.log('npm run release:prepare -- --version 1.0.1 --commits SHA1,SHA2 --notes <仓库外的更新说明.md>\n首次发布可用 --initial --version 1.0.0，不传 --commits。\n只创建本地 rc/v版本 分支，不自动推送、合并、打标签或公开发布。');
    } else {
      const options = {};
      for (let index = 0; index < args.length;) {
        if (args[index] === '--initial') { if (options.initial) throw Error('不能重复传入 --initial。'); options.initial = true; index++; continue; }
        if (!['--version', '--commits', '--notes'].includes(args[index]) || !args[index + 1] || options[args[index]]) throw Error('参数不正确；使用 --help 查看示例。');
        options[args[index]] = args[index + 1];
        index += 2;
      }
      if (!options['--notes']) throw Error('缺少 --notes 更新说明文件。');
      const result = prepareRelease({ version: options['--version'], commits: options['--commits']?.split(',').map(sha => sha.trim()), notesFile: options['--notes'], initial: options.initial === true });
      console.log(`已准备 ${result.branch}，包含 ${result.commits.length} 个开发提交。\n先验证并检查 git diff origin/release...HEAD，再执行：\ngit push -u origin ${result.branch}\n发布 PR：${result.compareUrl}\n合入 release 后只自动生成 Release 草稿，核对后再公开发布。`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
