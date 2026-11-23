import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const MODULES_DIR = join(ROOT_DIR, 'src', 'modules');

function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else if (/\.(mjs|js)$/.test(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}

const errors = [];
const moduleDirs = readdirSync(MODULES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());

// 1. Anti-coupling check: forbid cross-module relative imports inside src/modules/<slot>/
for (const dirEntry of moduleDirs) {
  const slotId = dirEntry.name;
  const slotDir = join(MODULES_DIR, slotId);
  const files = collectFiles(slotDir);

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf8');
    const relFile = relative(ROOT_DIR, filePath).replace(/\\/g, '/');

    const importRegex = /(?:from\s+['"]|import\s*\(\s*['"]|import\s+['"])(\.[^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const target = match[1];
      const resolved = join(dirname(filePath), target).replace(/\\/g, '/');
      const normalizedModulesDir = MODULES_DIR.replace(/\\/g, '/');

      if (resolved.startsWith(normalizedModulesDir)) {
        const afterModules = resolved.slice(normalizedModulesDir.length + 1);
        const targetSlot = afterModules.split('/')[0];
        if (targetSlot && targetSlot !== slotId) {
          errors.push(
            `Coupling violation in ${relFile}: imports "${target}" (belongs to module "${targetSlot}"). Use ctx.services.${targetSlot} or ctx.bus instead.`
          );
        }
      }
    }
  }
}

// 2. Optional Git PR territory check (when --base <ref> is supplied)
const baseFlagIndex = process.argv.indexOf('--base');
if (baseFlagIndex !== -1 && process.argv[baseFlagIndex + 1]) {
  const baseRef = process.argv[baseFlagIndex + 1];
  const branch = (process.env.GITHUB_HEAD_REF || execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' })).trim();
  const slotMatch = branch.match(/^feat\/[^-]+-(inventory|orders|billing|audit)$/);

  if (slotMatch) {
    const expectedPrefix = `src/modules/${slotMatch[1]}/`;
    const changed = execSync(`git diff --name-only ${baseRef}...HEAD`, { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const file of changed) {
      if (!file.startsWith(expectedPrefix)) {
        errors.push(`Territory violation on branch "${branch}": modified "${file}" outside "${expectedPrefix}"`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('BOUNDARY GUARD FAILED:');
  for (const err of errors) {
    console.error(` - ${err}`);
  }
  process.exit(1);
}

console.log('Boundary & coupling guard passed: 0 cross-module imports or territory violations.');
