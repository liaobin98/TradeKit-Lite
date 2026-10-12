import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRepository, inspectFile } from './check-repository.mjs';

const folders = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function temporaryRoot() {
  const parent = join(tmpdir(), 'opencode'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'repository-check-')); folders.push(root);
  return root;
}

describe('offline repository file checks', () => {
  it.each(['.env', '.env.local', '.dev.vars', '.dev.vars.production', 'server/.env'])('rejects local configuration %s', path => {
    expect(inspectFile(path, '', '.')).toContain(`${path}: 本地环境变量不能提交`);
  });
  it.each(['.env.example', '.dev.vars.example'])('allows a configuration template %s', path => {
    expect(inspectFile(path, 'AI_API_KEY=\n', '.')).toEqual([]);
  });
  it.each(['dist/index.html', 'node_modules/pkg/index.js', 'test-artifacts/test.png', 'coverage/index.html', '.wrangler/state/db', 'private.pem', 'private.pfx', 'debug.log', 'cache.tsbuildinfo', 'public/LICENSE', 'public/THIRD-PARTY-NOTICES.txt'])('rejects generated or credential files %s', path => {
    expect(inspectFile(path, null, '.')).not.toEqual([]);
  });
  it('reports credential location without exposing its value', () => {
    const token = 'gh' + 'p_' + 'a'.repeat(36);
    const errors = inspectFile('src/config.ts', `// config\nconst token = '${token}';`, '.');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('src/config.ts:2:');
    expect(errors[0]).not.toContain(token);
  });
  it('detects private keys and merge conflicts but permits ordinary Markdown headings', () => {
    expect(inspectFile('src/config.ts', ['-----BEGIN', 'PRIVATE KEY-----'].join(' '), '.')).not.toEqual([]);
    expect(inspectFile('src/config.ts', '<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n', '.')).not.toEqual([]);
    expect(inspectFile('README.md', '# Heading\n\n## Heading\n', '.')).toEqual([]);
  });
  it('checks local Markdown links, including encoded spaces, without fetching external links', () => {
    const root = temporaryRoot();
    writeFileSync(join(root, 'guide name.md'), '# Guide');
    expect(inspectFile('README.md', '[Guide](guide%20name.md#section)\n[Web](https://example.invalid)\n[Here](#section)', root)).toEqual([]);
    expect(inspectFile('README.md', '[Missing](deleted.md)', root)).toContain('README.md: 文档链接目标不存在（deleted.md）');
    expect(inspectFile('README.md', '[Invalid](bad%XY.md)', root)).toContain('README.md: 文档链接编码不正确');
  });
  it('permits build-time external site URLs only inside public site templates', () => {
    const template = '[Guide](__SITE_URL__/guide/)';
    expect(inspectFile('site/llms.txt.md', template, '.')).toEqual([]);
    expect(inspectFile('README.md', template, '.')).not.toEqual([]);
  });
  it('checks tracked ignored files too, skips deleted files and never stages new files', () => {
    const root = temporaryRoot();
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-b', 'main');
    const pkg = { name: 'fixture', version: '1.0.0', engines: { node: '>=22' } };
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: { '': pkg } }));
    writeFileSync(join(root, '.gitignore'), '.env\ndist/\n');
    mkdirSync(join(root, 'dist')); writeFileSync(join(root, 'dist/index.html'), 'generated');
    writeFileSync(join(root, '.env'), 'AI_API_KEY=fixture');
    writeFileSync(join(root, 'deleted.md'), '# Deleted');
    git('add', 'deleted.md'); rmSync(join(root, 'deleted.md'));
    const before = git('status', '--porcelain');
    expect(checkRepository(root).errors).toEqual([]);
    expect(git('status', '--porcelain')).toBe(before);
    git('add', '-f', '.env');
    expect(checkRepository(root).errors).toContain('.env: 本地环境变量不能提交');
    pkg.version = '1.0.1'; writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
    expect(checkRepository(root).errors).toContain('package-lock.json: 根包 version 与 package.json 不一致');
  });
});
