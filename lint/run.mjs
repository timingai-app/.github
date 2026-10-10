/**
 * The GitHub side of PR lint, called from the reusable workflow via
 * actions/github-script: gather the PR's facts, run lintPr, and keep ONE
 * comment on the PR up to date (found by its marker, edited in place).
 *
 * enforce=false (soft mode): problems show as a comment and a warning; the
 * check itself stays green. enforce=true: the check fails.
 */
import { readFileSync } from 'node:fs';
import { lintPr } from './lint.mjs';

const MARKER = '<!-- pr-lint -->';
const GUIDE = 'https://github.com/timingai-app/.github#pull-requests';

export async function run({ github, context, core, rulesPath, enforce }) {
  const rules = JSON.parse(readFileSync(rulesPath, 'utf8'));
  const pr = context.payload.pull_request;
  const { owner, repo } = context.repo;

  if (pr.draft) return core.info('Draft PR — skipped.');
  if (pr.user.type === 'Bot') return core.info('Bot PR — skipped.');

  const files = (await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: pr.number, per_page: 100 })).map((f) => f.filename);
  const result = lintPr({
    repo,
    title: pr.title,
    body: pr.body ?? '',
    base: pr.base.ref,
    files,
    labels: (pr.labels ?? []).map((l) => l.name),
  }, rules);

  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: pr.number, per_page: 100 });
  const existing = comments.find((c) => c.body?.includes(MARKER));
  const body = render(result, rules, enforce);

  if (result.problems.length === 0 && !existing) return core.info('PR lint: all good.');
  if (existing) {
    if (existing.body !== body) await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number: pr.number, body });
  }

  if (result.problems.length) {
    const summary = `PR lint: ${result.problems.length} item(s) to fix — see the PR comment.`;
    if (enforce) core.setFailed(summary);
    else core.warning(summary);
  }
}

export function render(result, rules, enforce) {
  if (result.skipped) return `${MARKER}\n⏭️ **PR lint skipped** — \`${rules.skipLabel}\` label is set.`;
  if (result.problems.length === 0) return `${MARKER}\n✅ **PR lint** — title and description look good.`;
  const lines = result.problems.map((p) => `- [ ] ${p.message}`);
  const spec = result.type ? rules.types[result.type] : null;
  const needs = spec ? `\n\n\`${result.type}\` needs: ${spec.required.map((k) => `\`## ${rules.sections[k]}\``).join(', ')}.` : '';
  const mode = enforce ? '' : '\n\n<sub>Soft mode: this doesn\'t block merging yet.</sub>';
  return `${MARKER}\n📋 **PR lint** — ${result.problems.length} item(s) to fix:\n\n${lines.join('\n')}${needs}\n\nEdit the title or description and this re-checks automatically. [How to write a PR](${GUIDE})${mode}`;
}
