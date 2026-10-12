import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseVersion, compareVersions, validateManifest, validateNotes, releaseNotes, updateChangelog } from './release-lib.mjs';
import { prepareRelease } from './prepare-release.mjs';

const notes = '## 修复与改进\n\n- 修复保存失败，并保留原有业务数据。\n\n## 验证\n\n- 单元测试与构建已经通过。';
const folders = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function fixture() {
  const parent = join(tmpdir(), 'opencode'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'release-flow-')); folders.push(root);
  const cwd = join(root, 'work'), remote = join(root, 'remote.git'); mkdirSync(cwd);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' } });
    if (result.status !== 0) throw Error(result.stderr || result.stdout);
    return result.stdout.trim();
  };
  git('init', '--bare', remote); git('init', '-b', 'main');
  git('config', 'user.name', 'Release fixture'); git('config', 'user.email', 'release-fixture@example.invalid');
  git('config', 'core.autocrlf', 'false');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2) + '\n');
  writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'fixture', version: '1.0.0' } } }, null, 2) + '\n');
  writeFileSync(join(cwd, 'CHANGELOG.md'), '# 更新记录\n\n## [Unreleased]\n\n');
  writeFileSync(join(cwd, 'feature.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'chore: baseline');
  const base = git('rev-parse', 'HEAD'); git('branch', 'release'); git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'main', 'release');
  writeFileSync(join(cwd, 'first.txt'), 'chosen first\n'); git('add', '.'); git('commit', '-m', 'fix: first selected change');
  const first = git('rev-parse', 'HEAD');
  writeFileSync(join(cwd, 'second.txt'), 'chosen second\n'); git('add', '.'); git('commit', '-m', 'feat: second selected change');
  const second = git('rev-parse', 'HEAD');
  writeFileSync(join(cwd, 'not-ready.txt'), 'do not release\n'); git('add', '.'); git('commit', '-m', 'feat: unfinished work'); git('push', 'origin', 'main');
  const notesFile = join(root, 'notes.md'); writeFileSync(notesFile, notes);
  return { cwd, git, base, first, second, notesFile };
}

describe('release metadata and notes', () => {
  it.each(['1.0.0', '0.2.0', '2.3.4-rc.1'])('accepts controlled version %s', version => { expect(parseVersion(version)).toBeTruthy(); });
  it.each(['v1.0.0', '../secret', '01.2.3', '1.0.0\nTAG=x', '1.0.0;echo bad', '1.0.0-rc.01'])('rejects unsafe or nonconforming version %s', version => { expect(() => parseVersion(version)).toThrow(); });
  it('orders numeric and prerelease versions without lexical mistakes', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.1-rc.10', '1.0.1-rc.2')).toBe(1);
    expect(compareVersions('1.0.1', '1.0.1-rc.10')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  it('requires real update notes, not empty text or the unedited template', () => {
    expect(validateNotes(notes)).toBe(notes);
    expect(() => validateNotes('')).toThrow();
    expect(() => validateNotes('## 新增\n\n- 待填写：本次更新的内容，需要修改模板。')).toThrow('占位');
  });
  it('links only selected source commits and refuses duplicate versions in changelog', () => {
    const sha = 'a'.repeat(40), text = releaseNotes('1.0.1', notes, [{ sha, subject: 'fix: save' }], 'b'.repeat(40));
    expect(text).toContain(`/commit/${sha}`); expect(text).toContain('不自动包含其他 main 改动');
    const changelog = updateChangelog('# Updates\n\n## [Unreleased]\n\n## [1.0.0]\n\nOld release\n', '1.0.1', notes, '2026-10-11');
    expect(changelog.indexOf('## [1.0.1]')).toBeLessThan(changelog.indexOf('## [1.0.0]'));
    expect(changelog).toContain('Old release');
    expect(() => updateChangelog(changelog, '1.0.1', notes, '2026-10-11')).toThrow('已有');
  });
  it('refuses incorrect source branches, duplicate SHAs and inconsistent initial plans', () => {
    const plan = { schemaVersion: 1, version: '1.0.1', sourceBranch: 'main', targetBranch: 'release', initial: false, baseCommit: 'b'.repeat(40), sourceCommits: [{ sha: 'a'.repeat(40), subject: 'fix' }], preparedAt: '2026-10-11T00:00:00Z' };
    expect(validateManifest(plan, '1.0.1')).toBe(plan);
    expect(() => validateManifest({ ...plan, sourceBranch: 'wrong' }, '1.0.1')).toThrow();
    expect(() => validateManifest({ ...plan, sourceCommits: [...plan.sourceCommits, ...plan.sourceCommits] }, '1.0.1')).toThrow();
    expect(() => validateManifest({ ...plan, initial: true }, '1.0.1')).toThrow();
  });
});

describe('selected-commit release preparation', () => {
  it('picks two development commits, excludes other changes and preserves both long-lived branches', () => {
    const f = fixture(), main = f.git('rev-parse', 'main');
    const result = prepareRelease({ version: '1.0.1', commits: [f.first, f.second], notesFile: f.notesFile, cwd: f.cwd });
    expect(result.branch).toBe('rc/v1.0.1');
    expect(existsSync(join(f.cwd, 'first.txt'))).toBe(true); expect(existsSync(join(f.cwd, 'second.txt'))).toBe(true);
    expect(existsSync(join(f.cwd, 'not-ready.txt'))).toBe(false);
    expect(f.git('rev-parse', 'main')).toBe(main); expect(f.git('rev-parse', 'release')).toBe(f.base);
    const manifest = JSON.parse(readFileSync(join(f.cwd, 'docs/releases/v1.0.1.json'), 'utf8'));
    expect(manifest.sourceCommits.map(commit => commit.sha)).toEqual([f.first, f.second]);
    expect(f.git('log', '--format=%B', `${f.base}..HEAD`)).toContain(`cherry picked from commit ${f.first}`);
    expect(JSON.parse(readFileSync(join(f.cwd, 'package-lock.json'), 'utf8')).packages[''].version).toBe('1.0.1');
    expect(f.git('status', '--porcelain')).toBe('');
    const check = spawnSync(process.execPath, [resolve('scripts/check-release.mjs')], { cwd: f.cwd, encoding: 'utf8' });
    expect(check.status, check.stderr).toBe(0);
  });
  it('supports a single selected commit without including later development work', () => {
    const f = fixture(); prepareRelease({ version: '1.0.1', commits: [f.second], notesFile: f.notesFile, cwd: f.cwd });
    expect(existsSync(join(f.cwd, 'first.txt'))).toBe(false); expect(existsSync(join(f.cwd, 'second.txt'))).toBe(true);
  });
  it('prepares the initial release baseline without accidentally including subsequent main commits', () => {
    const f = fixture(); prepareRelease({ version: '1.0.0', initial: true, notesFile: f.notesFile, cwd: f.cwd });
    expect(existsSync(join(f.cwd, 'first.txt'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(f.cwd, 'docs/releases/v1.0.0.json'), 'utf8'));
    expect(manifest.initial).toBe(true); expect(manifest.sourceCommits[0].sha).toBe(f.base);
  });
  it('rejects dirty working trees without switching branches or discarding changes', () => {
    const f = fixture(); writeFileSync(join(f.cwd, 'feature.txt'), 'user edit\n');
    expect(() => prepareRelease({ version: '1.0.1', commits: [f.first], notesFile: f.notesFile, cwd: f.cwd })).toThrow('未提交');
    expect(f.git('branch', '--show-current')).toBe('main'); expect(readFileSync(join(f.cwd, 'feature.txt'), 'utf8')).toBe('user edit\n');
  });
  it('rejects already-included baseline commits and reversed selection before creating a branch', () => {
    const f = fixture();
    expect(() => prepareRelease({ version: '1.0.1', commits: [f.base], notesFile: f.notesFile, cwd: f.cwd })).toThrow('已在发布线');
    expect(() => prepareRelease({ version: '1.0.1', commits: [f.second, f.first], notesFile: f.notesFile, cwd: f.cwd })).toThrow();
    expect(f.git('branch', '--show-current')).toBe('main');
  });
});
