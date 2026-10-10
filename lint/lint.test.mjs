import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintPr, parseSections, parseTitle } from './lint.mjs';

const rules = JSON.parse(readFileSync(new URL('../pr-rules.json', import.meta.url), 'utf8'));
const rulesOf = (pr) => lintPr({ repo: 'backstage', base: 'main', files: [], labels: [], ...pr }, rules).problems.map((p) => p.rule);

const FEAT_BODY = `## Why
Users can't see who signed up today.

## What changed
- Adds a daily signup card

## How verified
npm test — 40 pass; opened the page locally

## Related
req#353`;

test('titles: type(scope): description, scope may be mixed case', () => {
  assert.deepEqual(parseTitle('feat(chatbotV2): question summaries', rules), { type: 'feat', scope: 'chatbotV2', breaking: false, description: 'question summaries' });
  assert.equal(parseTitle('fix: 把依赖钉到 prod 的版本', rules)?.type, 'fix');
  assert.equal(parseTitle('feat(api)!: drop the 90d range', rules)?.breaking, true);
  for (const bad of ['Fix/shareloop', 'SEO: venus page', 'T20c server: card cancel', 'chat: retry badge', 'Feat(ui): x', 'feat(ui):x', 'style(mood): copy', 'feat: ']) {
    assert.equal(parseTitle(bad, rules), null, bad);
  }
});

test('a complete feat passes', () => {
  assert.deepEqual(rulesOf({ title: 'feat(dashboard): daily signup card', body: FEAT_BODY }), []);
});

test('missing sections are reported one by one', () => {
  assert.deepEqual(rulesOf({ title: 'feat: x', body: '## Why\nbecause' }).sort(), ['section:related', 'section:verified', 'section:what']);
});

test('template comments alone do not count as content', () => {
  const body = FEAT_BODY.replace('npm test — 40 pass; opened the page locally', '<!-- commands you ran, devices you tried -->');
  assert.deepEqual(rulesOf({ title: 'feat: x', body }), ['section:verified']);
});

test('headings match case-insensitively and may carry a hint after them', () => {
  const body = FEAT_BODY.replace('## How verified', '## how verified (commands, devices)');
  assert.deepEqual(rulesOf({ title: 'feat: x', body }), []);
});

test('None: allowed only in the optional-by-nature sections, and feat needs a reason', () => {
  assert.deepEqual(rulesOf({ title: 'feat: x', body: FEAT_BODY.replace('req#353', 'None') }), ['section:related']);
  assert.deepEqual(rulesOf({ title: 'feat: x', body: FEAT_BODY.replace('req#353', 'None — small tweak Devin asked for in chat') }), []);
  assert.deepEqual(rulesOf({ title: 'fix: x', body: FEAT_BODY.replace('req#353', 'None') }), []);
  assert.deepEqual(rulesOf({ title: 'fix: x', body: FEAT_BODY.replace('npm test — 40 pass; opened the page locally', 'N/A') }), ['section:verified']);
});

test('tune needs a Before / After comparison', () => {
  const body = '## Why\nTabs too similar\n\n## What changed\nLENS_SPREAD_GAIN 3 → 6\n\n## How verified\n';
  assert.deepEqual(rulesOf({ title: 'tune(match): widen spread', body: `${body}ran the sample` }), ['section:verified']);
  assert.deepEqual(rulesOf({ title: 'tune(match): widen spread', body: `${body}Before: 4.1/4.3/4.2 · After: 3.2/4.9/5.6` }), []);
});

test('core repos: day-to-day types never target main; release and hotfix only target main', () => {
  const pr = { repo: 'timing-api', title: 'fix: x', body: FEAT_BODY };
  assert.ok(lintPr({ ...pr, base: 'main' }, rules).problems.some((p) => p.rule === 'base'));
  assert.ok(!lintPr({ ...pr, base: '1.2.12' }, rules).problems.some((p) => p.rule === 'base'));
  assert.ok(!lintPr({ ...pr, repo: 'website', base: 'main' }, rules).problems.some((p) => p.rule === 'base'));
  assert.ok(lintPr({ ...pr, title: 'release: 1.2.12 → main', base: '1.2.12' }, rules).problems.some((p) => p.rule === 'base'));
});

test('hotfix requires the forward-port plan', () => {
  const body = `${FEAT_BODY}\n\n## Deploy notes\nNone\n\n## Rollback\nrevert the merge`;
  assert.deepEqual(rulesOf({ repo: 'timing-api', title: 'hotfix(astro): stop-loss', body }), ['section:forwardPort']);
  assert.deepEqual(rulesOf({ repo: 'timing-api', title: 'hotfix(astro): stop-loss', body: `${body}\n\n## Forward-port\nmerge main into 1.2.12 right after` }), []);
});

test('file rules: a migration makes Deploy notes required and None not enough', () => {
  const files = ['db/migrations/0051_x.sql'];
  assert.deepEqual(rulesOf({ title: 'chore(db): x', body: '## What changed\nadds a check', files }), ['section:deploy']);
  assert.deepEqual(rulesOf({ title: 'chore(db): x', body: '## What changed\nadds a check\n\n## Deploy notes\nNone', files }), ['section:deploy']);
  assert.deepEqual(rulesOf({ title: 'chore(db): x', body: '## What changed\nadds a check\n\n## Deploy notes\nApply after merge; only one DB', files }), []);
  assert.deepEqual(rulesOf({ repo: 'timing-db', title: 'feat: x', body: FEAT_BODY, files: ['supabase/x.sql'] }), ['section:deploy']);
  assert.deepEqual(rulesOf({ repo: 'timing-db', title: 'ci: x', body: '## What changed\nadds CI\n\n## Deploy notes\nNone', files: ['.github/workflows/pr-lint.yml'] }), []);
});

test('file rules: a UI feat needs Screenshots, None accepted', () => {
  const files = ['components/Card.tsx'];
  assert.deepEqual(rulesOf({ title: 'feat: x', body: FEAT_BODY, files }), ['section:screenshots']);
  assert.deepEqual(rulesOf({ title: 'feat: x', body: `${FEAT_BODY}\n\n## Screenshots\nNone — no visible change`, files }), []);
  assert.deepEqual(rulesOf({ title: 'fix: x', body: FEAT_BODY, files }), []);
  assert.deepEqual(rulesOf({ repo: 'timing-lark-bot', title: 'feat: x', body: FEAT_BODY, files }), []);
});

test('skip label skips everything; long titles are flagged', () => {
  assert.equal(lintPr({ repo: 'x', title: 'whatever', base: 'main', labels: ['skip-pr-lint'] }, rules).skipped, true);
  assert.deepEqual(rulesOf({ title: `feat: ${'x'.repeat(100)}`, body: FEAT_BODY }), ['title-length']);
});

test('sections stop at the next ## heading and ignore a # heading', () => {
  const s = parseSections('## Why\na\n# Top\nnot part\n## What changed\nb');
  assert.equal(s.get('why'), 'a');
  assert.equal(s.get('what changed'), 'b');
});

test('the comment: one checklist line per problem, a pass message, and the soft-mode note', async () => {
  const { render } = await import('./run.mjs');
  const fail = lintPr({ repo: 'x', title: 'Fix/shareloop', base: 'main', body: '' }, rules);
  const text = render(fail, rules, false);
  assert.match(text, /^<!-- pr-lint -->/);
  assert.match(text, /- \[ \] Title must be/);
  assert.match(text, /Soft mode/);
  assert.doesNotMatch(render(fail, rules, true), /Soft mode/);
  assert.match(render({ type: 'feat', problems: [] }, rules, false), /✅/);
});

test('templates carry every required heading of their type, and an untouched template does not pass', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const cases = [['pull_request_template.md', ['feat', 'fix', 'perf', 'refactor', 'tune', 'docs', 'chore']], ['PULL_REQUEST_TEMPLATE/release.md', ['release']], ['PULL_REQUEST_TEMPLATE/hotfix.md', ['hotfix']], ['PULL_REQUEST_TEMPLATE/sync.md', ['sync']]];
  for (const [file, types] of cases) {
    const headings = [...read(file).matchAll(/^## (.+)$/gm)].map((m) => m[1].trim().toLowerCase());
    for (const type of types) {
      for (const key of rules.types[type].required) assert.ok(headings.includes(rules.sections[key].toLowerCase()), `${file} lacks ## ${rules.sections[key]} for ${type}`);
      const base = ['release', 'hotfix'].includes(type) ? 'main' : '1.2.12';
      assert.ok(lintPr({ repo: 'timing-api', title: `${type}: x`, base, body: read(file) }, rules).problems.length > 0, `${file} untouched passes for ${type}`);
    }
  }
});
