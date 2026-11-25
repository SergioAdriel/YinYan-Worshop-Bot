/** Ejecuta la suite y guarda evidencia verificable sin inventar resultados. */
import {spawn} from 'node:child_process';
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const startedAt = new Date().toISOString();
const names = (await readdir(resolve(root, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort();
const files = names.map(name => resolve(root, 'tests', name));
const hashes = {};
for (const folder of ['src', 'scripts', 'web', 'tests']) {
  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory() && entry.name !== '__pycache__' && entry.name !== 'simulation') await visit(path);
      else if (entry.isFile() && /\.(?:py|mjs|js|html|css|cmd)$/.test(entry.name)) {
        const name = path.slice(root.length + 1).replaceAll('\\', '/');
        hashes[name] = createHash('sha256').update(await readFile(path)).digest('hex');
      }
    }
  }
  await visit(resolve(root, folder));
}
const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...files], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', chunk => {const text = chunk.toString('utf8'); output += text; process.stdout.write(text);});
child.stderr.on('data', chunk => {const text = chunk.toString('utf8'); output += text; process.stderr.write(text);});
const exitCode = await new Promise((done, fail) => {child.once('error', fail); child.once('close', done);});
const total = kind => Number(new RegExp(`^# ${kind} (\\d+)$`, 'm').exec(output)?.[1] || 0);
const result = {
  started_at: startedAt, finished_at: new Date().toISOString(),
  command: 'node --test --test-reporter=tap tests/*.test.mjs', exit_code: exitCode,
  tests: total('tests'), passed: total('pass'), failed: total('fail'), skipped: total('skipped'),
  complete: exitCode === 0 && total('tests') > 0 && total('fail') === 0 && total('skipped') === 0,
  test_files: names, source_hashes: hashes,
};
await mkdir(resolve(root, 'reports'), {recursive: true});
await writeFile(resolve(root, 'reports/test-results.json'), JSON.stringify(result, null, 2) + '\n');
if (!result.complete) process.exitCode = exitCode || 1;
