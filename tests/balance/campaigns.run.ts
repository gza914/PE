/**
 * `npm run balance`: plays AI-vs-AI campaigns and prints the GDD balance
 * report. RUNS sets how many (default 12); every other run starts a few
 * low-lean lieutenants neutral to measure neutral risk. TUNE takes a JSON
 * object deep-merged into tuning, for quick experiments:
 * TUNE='{"ai":{"forces":{"mercMen":6}}}' RUNS=20 npm run balance
 */
import { it } from 'vitest';
import { bundledContent } from '../../src/data/bundled';
import { runCampaign, summarize } from '../../src/sim/balance';

it('balance report', () => {
  const content = bundledContent();
  if (process.env.TUNE) merge(content.tuning as unknown as Record<string, unknown>, JSON.parse(process.env.TUNE) as Record<string, unknown>);
  const runs = Number(process.env.RUNS ?? 12);
  const neutrals = ['c_san_ignacio', 'c_cosala', 'm_angostura', 'm_la_cruz'];
  const stats = Array.from({ length: runs }, (_, i) => runCampaign(content, 1000 + i, { neutrals: i % 2 ? neutrals : [] }));
  const report = summarize(content, stats);
  process.stdout.write('\n' + report.lines.join('\n') + '\n');
  for (const r of stats) for (const p of r.invariantProblems.slice(0, 3)) process.stdout.write(`  seed ${r.seed}: ${p}\n`);
});

function merge(into: Record<string, unknown>, from: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object') merge(cur as Record<string, unknown>, v as Record<string, unknown>);
    else into[k] = v;
  }
}
