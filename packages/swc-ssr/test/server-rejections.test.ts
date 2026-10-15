/**
 * Review M2: unhandled rejections during a render. The server used to install a process-wide `unhandledRejection`
 * listener while any render was in progress and turned EVERY rejection of the process into a report warning
 * (renders span macrotasks, so rejections of unrelated requests were swallowed). Now only rejections of promises
 * created by the render (its AsyncLocalStorage scope) are attributed - to the element whose hook created them -
 * and everything else gets Node's behaviour.
 *
 * Each scenario runs in a child process (see fixtures/rejections.fixture.ts): the test runner fails a file on any
 * unhandled rejection in its own process.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/rejections.fixture.ts', import.meta.url));

function run(scenario: string) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', fixture], {
    encoding: 'utf8',
    env: {...process.env, SCENARIO: scenario, NODE_OPTIONS: ''},
    timeout: 60_000,
  });
  const line = child.stdout
    .split('\n')
    .reverse()
    .find((text) => text.startsWith('{'));
  return {
    status: child.status,
    stderr: child.stderr,
    result: line ? (JSON.parse(line) as {messages: string[]; seenByApp: string[]}) : undefined,
  };
}

test('a rejection created by an element hook is attributed to that element; unrelated ones are not swallowed', () => {
  const {status, result, stderr} = run('attribution');
  assert.equal(status, 0, stderr);
  assert.ok(result, `no result line:\n${stderr}`);
  assert.ok(
    result.messages.some((message) => message.startsWith('x-rejecting: ') && message.includes('rejection from x-rejecting')),
    `attributed to the element:\n${result.messages.join('\n')}`
  );
  assert.ok(
    !result.messages.some((message) => message.includes('unrelated rejection')),
    `an unrelated rejection must not end up in the render report:\n${result.messages.join('\n')}`
  );
  assert.ok(result.seenByApp.includes('unrelated rejection'), "the application's listener gets it");
});

test("without an application listener an unrelated rejection keeps Node's default (the process fails)", () => {
  const {status, stderr} = run('unrelated');
  assert.notEqual(status, 0, 'the process must fail as it would without swc-ssr');
  assert.match(stderr, /unrelated rejection/);
});

test('a late rejection of a finished render does not crash the server', () => {
  const {status, result, stderr} = run('late');
  assert.equal(status, 0, stderr);
  assert.ok(result, `no result line:\n${stderr}`);
});
