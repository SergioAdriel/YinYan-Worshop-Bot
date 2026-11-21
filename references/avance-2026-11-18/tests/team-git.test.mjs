import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const available = process.platform === 'win32' && spawnSync('git', ['--version'], {windowsHide: true}).status === 0;

function command(binary, args, cwd, env, input) {
  return new Promise((done, fail) => {
    const child = spawn(binary, args, {cwd, env, windowsHide: true, stdio: 'pipe'});
    let output = '';
    const timer = setTimeout(() => {child.kill(); fail(new Error(`Tiempo agotado: ${binary} ${args.join(' ')}\n${output}`));}, 12000);
    child.stdout.on('data', data => {output += data;});
    child.stderr.on('data', data => {output += data;});
    child.on('error', error => {clearTimeout(timer); fail(error);});
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) done(output.trim());
      else fail(new Error(`${binary} terminó con ${code}: ${output}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}

test('Los ayudantes Git intercambian aportaciones A/B entre dos clones sin usar la red',
  {skip: !available, timeout: 30000}, async () => {
    const workspace = await mkdtemp(join(tmpdir(), `yinyan-team-git-${randomUUID()}-`));
    const bare = join(workspace, 'origin.git');
    const cloneA = join(workspace, 'compañero A');
    const cloneB = join(workspace, 'compañero B');
    const env = {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(workspace, 'isolated-gitconfig')};
    const git = (cwd, ...args) => command('git', args, cwd, env);
    const helper = (cwd, name) => command('cmd.exe', ['/d', '/c', name], cwd, env, '\r\n');
    try {
      await writeFile(env.GIT_CONFIG_GLOBAL, '', 'utf8');
      await git(workspace, 'init', '--bare', '--initial-branch=main', bare);
      await git(workspace, 'clone', bare, cloneA);
      await git(cloneA, 'config', 'user.name', 'Prueba local A');
      await git(cloneA, 'config', 'user.email', 'a@example.invalid');
      await mkdir(join(cloneA, 'data/team'), {recursive: true});
      const readme = 'Repositorio temporal para probar aportaciones.\n';
      await writeFile(join(cloneA, 'README.md'), readme, 'utf8');
      await writeFile(join(cloneA, '.gitignore'), await readFile(join(root, '.gitignore')));
      await writeFile(join(cloneA, 'data/team/.gitkeep'), '', 'utf8');
      for (const name of ['recibir-aportes.cmd', 'subir-aportes.cmd']) {
        await writeFile(join(cloneA, name), await readFile(join(root, name)));
      }
      await git(cloneA, 'add', '--', 'README.md', '.gitignore', 'data/team', 'recibir-aportes.cmd', 'subir-aportes.cmd');
      await git(cloneA, 'commit', '-m', 'Proyecto de prueba');
      await git(cloneA, 'push', '-u', 'origin', 'main');
      await git(workspace, 'clone', bare, cloneB);
      await git(cloneB, 'config', 'user.name', 'Prueba local B');
      await git(cloneB, 'config', 'user.email', 'b@example.invalid');

      const idA = randomUUID(), idB = randomUUID();
      const relativeA = `data/team/alumno-a/queries/${idA}.json`;
      const relativeB = `data/team/alumno-b/queries/${idB}.json`;
      const queryA = {id: idA, author: 'alumno-a', text: 'mi telefono parpadia', created_at: new Date().toISOString()};
      const queryB = {id: idB, author: 'alumno-b', text: 'mi compu no carga', created_at: new Date().toISOString()};
      await mkdir(dirname(join(cloneA, relativeA)), {recursive: true});
      await writeFile(join(cloneA, relativeA), JSON.stringify(queryA), 'utf8');
      await writeFile(join(cloneA, 'README.md'), `${readme}Cambio ajeno al registro.\n`, 'utf8');
      await git(cloneA, 'add', '--', 'README.md');
      const pushedA = await helper(cloneA, 'subir-aportes.cmd');
      assert.match(pushedA, /Aportes enviados/i, pushedA);
      assert.equal(await git(cloneA, 'show', 'HEAD:README.md'), readme.trim(), 'Subir aportes no incluye otros cambios preparados.');
      assert.equal(await git(cloneA, 'diff', '--cached', '--name-only'), 'README.md');
      await writeFile(join(cloneA, 'README.md'), readme, 'utf8');
      await git(cloneA, 'add', '--', 'README.md');

      const receivedB = await helper(cloneB, 'recibir-aportes.cmd');
      assert.match(receivedB, /Listo\./i, receivedB);
      assert.deepEqual(JSON.parse(await readFile(join(cloneB, relativeA), 'utf8')), queryA);
      await mkdir(dirname(join(cloneB, relativeB)), {recursive: true});
      await writeFile(join(cloneB, relativeB), JSON.stringify(queryB), 'utf8');
      const pushedB = await helper(cloneB, 'subir-aportes.cmd');
      assert.match(pushedB, /Aportes enviados/i, pushedB);
      const receivedA = await helper(cloneA, 'recibir-aportes.cmd');
      assert.match(receivedA, /Listo\./i, receivedA);
      assert.deepEqual(JSON.parse(await readFile(join(cloneA, relativeB), 'utf8')), queryB);
      assert.deepEqual(JSON.parse(await readFile(join(cloneA, relativeA), 'utf8')), queryA);
      assert.equal(await git(cloneA, 'rev-parse', 'HEAD'), await git(cloneB, 'rev-parse', 'HEAD'));
      assert.equal(await git(cloneA, 'status', '--porcelain'), '', 'Los ayudantes terminan con ambos clones sincronizados.');
      assert.equal(await git(cloneB, 'status', '--porcelain'), '');
    } finally {
      // Verificar el destino absoluto antes de eliminar únicamente el árbol creado por esta prueba.
      const target = await realpath(workspace);
      assert.equal(dirname(target), await realpath(tmpdir()));
      assert.ok(basename(target).startsWith('yinyan-team-git-'));
      assert.equal(resolve(target), resolve(workspace));
      await rm(target, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
    }
  });
