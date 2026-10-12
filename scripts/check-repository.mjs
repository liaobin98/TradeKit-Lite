import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const textFile = /\.(?:[cm]?js|[cm]?ts|tsx|jsx|css|html|jsonc?|ya?ml|md|svg|txt|example)$/i;
const secrets = [
  ['私钥', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['模型 API key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/],
];

// Report paths and line numbers only, never print a suspected credential.
export function inspectFile(path, content, root) {
  const errors = [];
  const name = path.split('/').at(-1);
  if (/^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/.test(name) && !['.env.example', '.dev.vars.example'].includes(name)) {
    errors.push(`${path}: 本地环境变量不能提交`);
  }
  if (/(?:^|\/)(?:node_modules|dist|test-artifacts|coverage|\.wrangler|\.edgeone)\//.test(path) || /\.(?:log|tsbuildinfo|pem|key|p12|pfx)$/i.test(path) || ['public/LICENSE', 'public/THIRD-PARTY-NOTICES.txt'].includes(path)) {
    errors.push(`${path}: 生成产物或凭证文件不能提交`);
  }
  if (content === null) return errors;
  if (/^(?:<<<<<<< |=======\r?$|>>>>>>> )/m.test(content)) errors.push(`${path}: 存在合并冲突标记`);
  for (const [label, pattern] of secrets) {
    const match = pattern.exec(content);
    if (match) errors.push(`${path}:${content.slice(0, match.index).split('\n').length}: 疑似${label}，需人工核对`);
  }
  if (path.endsWith('.md')) {
    for (const match of content.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const link = match[1].trim().replace(/^<([^>]+)>$/, '$1');
      // Public site templates receive their external origin during the Vite build.
      if (path.startsWith('site/') && link.startsWith('__SITE_URL__/')) continue;
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(link)) continue;
      const local = link.split(/[?#]/, 1)[0];
      if (!local) continue;
      try {
        if (!existsSync(resolve(root, dirname(path), decodeURIComponent(local)))) errors.push(`${path}: 文档链接目标不存在（${local}）`);
      } catch { errors.push(`${path}: 文档链接编码不正确`); }
    }
  }
  return errors;
}

export function checkRepository(root = fileURLToPath(new URL('..', import.meta.url))) {
  // Read-only: includes tracked files and non-ignored new files, without staging,
  // committing, fetching or writing Git configuration. Skip deleted files.
  const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
  const errors = [];
  let checked = 0;
  for (const path of files) {
    const full = resolve(root, path);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    checked++;
    errors.push(...inspectFile(path, textFile.test(path) || ['.gitignore', '.gitattributes', 'LICENSE'].includes(path) ? readFileSync(full, 'utf8') : null, root));
  }
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  const locked = lock.packages?.[''];
  for (const key of ['name', 'version', 'engines', 'dependencies', 'devDependencies']) {
    if (!isDeepStrictEqual(pkg[key], locked?.[key])) errors.push(`package-lock.json: 根包 ${key} 与 package.json 不一致`);
  }
  return { checked, errors };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { checked, errors } = checkRepository();
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else {
      console.log(`仓库检查通过：${checked} 个候选文件；未发现受检凭证、生成产物、冲突标记或失效文档链接，npm 锁文件根配置一致。`);
      console.log('这是离线辅助检查，不替代人工敏感信息审查；未暂存、提交、联网或推送。');
    }
  } catch (error) {
    console.error('仓库检查失败：' + error.message);
    process.exitCode = 1;
  }
}
