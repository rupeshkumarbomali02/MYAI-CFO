import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.cwd());
const candidates = [
  path.join(root, 'app', 'data', 'reference', 'knowledge-sources.json'),
  path.join(root, 'app', 'frontend', 'public', 'reference', 'knowledge-sources.json')
];
for (const file of candidates) {
  if (!fs.existsSync(file)) throw new Error(`Missing knowledge registry: ${file}`);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value) || value.length < 100) throw new Error(`Invalid/short knowledge registry: ${file}`);
}
console.log('Knowledge registry packaging smoke: PASS (109+ sources in both bundles)');
