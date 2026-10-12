import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = relative => readFile(path.join(root, relative), 'utf8');
const manifest = JSON.parse(await read('package.json'));
const lock = JSON.parse(await read('package-lock.json'));
const projectLicense = await read('LICENSE');
const componentLicense = await read('src/components/ui/LICENSE');
const records = [];
const unavailable = [];
const review = [];
const blocks = [
  'TradeKit Lite — third-party notices',
  'Third-party works keep their original licenses and copyright notices.\n' +
    'This file includes installed production and development dependencies from package-lock.json;\n' +
    'it is a notice collection, not a determination of what is included in the browser bundle.\n' +
    'Dual-license choices: JSZip — MIT; DOMPurify — Apache-2.0; rgbcolor — MIT.\n' +
    'All original license alternatives are retained below.\n' +
    'Missing notices and incomplete metadata must be reviewed before distribution.',
  'Project code\n\n' + projectLicense,
  'Locally adapted shadcn/ui components\nSource: src/components/ui/\n' +
    'Local changes include styling and component integration.\n\n' + componentLicense,
];

const direct = new Set([
  ...Object.keys(manifest.dependencies || {}),
  ...Object.keys(manifest.devDependencies || {}),
]);

for (const location of Object.keys(lock.packages).filter(Boolean).sort()) {
  const entry = lock.packages[location];
  let pkg;
  try {
    pkg = JSON.parse(await read(location + '/package.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!entry.optional) throw new Error('Install the locked dependencies before collecting licenses: ' + location);
    unavailable.push({ location, version: entry.version, reason: 'Optional package not installed on this platform' });
    continue;
  }
  if (pkg.version !== entry.version) {
    throw new Error('Installed version differs from package-lock.json: ' + location);
  }

  const directory = path.join(root, location);
  const files = await readdir(directory, { withFileTypes: true });
  const notices = files.filter(f => f.isFile() && /^(licen[cs]e|copying|notice|unlicense)([._-]|$)/i.test(f.name))
    .map(f => f.name).sort();
  // A README is evidence only; it is not a substitute for a missing permission notice.
  const fallback = notices.length ? [] : files.filter(f => f.isFile() && /^readme([._-]|$)/i.test(f.name))
    .map(f => f.name).sort();
  const declared = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
  const license = declared || entry.license || 'UNDECLARED';
  const warnings = [];
  if (!notices.length) warnings.push('No standalone license/notice file; inspect README and upstream notices');
  if (license === 'UNDECLARED') warnings.push('No license declared in package metadata or lockfile');
  const record = {
    name: pkg.name,
    version: pkg.version,
    license,
    location,
    direct: direct.has(pkg.name) && location === 'node_modules/' + pkg.name,
    devOnly: !!entry.dev,
    noticeFiles: notices,
    fallbackFiles: fallback,
    warnings,
  };
  records.push(record);
  if (warnings.length) review.push(record);

  const parts = [
    `${pkg.name} ${pkg.version}\nDeclared license: ${license}\nInstalled path: ${location}`,
    ...warnings.map(w => 'REVIEW REQUIRED: ' + w),
  ];
  for (const name of [...notices, ...fallback]) {
    parts.push(`--- ${name} ---\n` + await read(location + '/' + name));
  }
  blocks.push(parts.join('\n\n'));
}

for (const name of direct) {
  if (!records.some(p => p.direct && p.name === name)) {
    throw new Error('Missing direct dependency: ' + name);
  }
}

const report = {
  scope: 'Installed packages from package-lock.json; includes development dependencies, not a bundle audit',
  projectLicense: manifest.license,
  packageCount: records.length,
  reviewRequired: review,
  unavailableOptionalPackages: unavailable,
  packages: records,
};
await mkdir(path.join(root, 'public'), { recursive: true });
await mkdir(path.join(root, 'docs'), { recursive: true });
await writeFile(path.join(root, 'public/LICENSE'), projectLicense);
await writeFile(path.join(root, 'public/THIRD-PARTY-NOTICES.txt'), blocks.join('\n\n' + '='.repeat(80) + '\n\n') + '\n');
await writeFile(path.join(root, 'docs/LICENSE-REPORT.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Collected notices for ${records.length} installed packages; ${review.length} require notice review.`);
if (review.length) console.warn('Review docs/LICENSE-REPORT.json before distribution; successful collection is not a compliance clearance.');
