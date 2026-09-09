'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const manifest = require('./manifest.json');
const { syntheticFixture } = require('./fixtures');
const { loadBaseline } = require('./baseline');
const { digest, mean, round, runDraft, releaseGate, validateFixture } = require('./core');

function summarize(runs) {
  return ['development', 'held-out'].flatMap(split => manifest.policies.map(policy => {
    const selected = runs.filter(run => run.split === split && run.policy === policy);
    if (!selected.length) return null;
    const times = selected.flatMap(run => run.decisions.map(row => row.durationMs)).sort((a, b) => a - b);
    const bins = Array.from({ length: 5 }, (_, index) => selected.reduce((sum, run) => {
      const row = run.calibration[index];
      for (const key of ['n', 'prediction', 'survived', 'squaredError']) sum[key] += row[key];
      return sum;
    }, { n: 0, prediction: 0, survived: 0, squaredError: 0 }));
    return { split, policy, runs: selected.length, incomplete: selected.filter(run => !run.metrics.complete || run.failures.length).length,
      roomFailures: selected.filter(run => !run.allRostersComplete || run.completedPicks !== 120 || run.uniquePicks !== 120).length,
      meanStartingPoints: round(mean(selected.map(run => run.metrics.normalStartingLineupSeasonTotal))),
      meanUniformWeekPoints: round(mean(selected.map(run => run.metrics.uniformWeekLineupPoints))),
      meanByePointLoss: round(mean(selected.map(run => run.metrics.byePointLoss))),
      meanByeSlotGaps: round(mean(selected.map(run => run.metrics.byeSlotGaps))),
      meanForecastPairGap: round(mean(selected.flatMap(run => run.decisions.map(row => row.opportunity?.forecastPairGap).filter(value => value != null)))),
      computeMs: { median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * .95)], max: times.at(-1), deadlineMisses: times.filter(time => time > manifest.candidate.deadlineMs).length },
      uncalibratedAdpSurvival: { brier: round(bins.reduce((sum, row) => sum + row.squaredError, 0) / Math.max(1, bins.reduce((sum, row) => sum + row.n, 0))),
        bins: bins.map((row, index) => ({ bin: index, observations: row.n, predicted: row.n ? round(row.prediction / row.n) : null, survived: row.n ? round(row.survived / row.n) : null })),
        limitation: 'Conditional survival of unchosen candidates until the next owned turn in synthetic rooms. These observations do not calibrate real Yahoo probabilities.' } };
  }).filter(Boolean));
}
function markdown(report) {
  const lines = ['# Controlled draft-policy comparison', '',
    'This is a synthetic strategy experiment under DR roster/scoring rules. It does not reproduce Yahoo grades, actual player projections or live browser reliability. The active Huddle scorer is unchanged.', '',
    `Frozen baseline: \`${report.baseline.commit}\`. Candidate: \`${manifest.candidate.version}\`. Input, baseline and implementation hashes are preserved in the JSON report.`, '',
    '| Split | Policy | Runs | Incomplete | Uniform-week points | Starting season total | Bye loss | Bye slot gaps | p95 computation ms |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const row of report.summary) lines.push(`| ${row.split} | ${row.policy} | ${row.runs} | ${row.incomplete} | ${row.meanUniformWeekPoints} | ${row.meanStartingPoints} | ${row.meanByePointLoss} | ${row.meanByeSlotGaps} | ${row.computeMs.p95} |`);
  lines.push('', 'Uniform-week points use an independent lineup optimizer for weeks 1–17, divide season projections by 17 active games, exclude byes and use owned reserves only. This is a common scoring objective, not a weekly forecast. Starting season totals, bye losses and empty slots are separate metrics. Bench season totals are not added as starter points.', '',
    'All four policies and all opponents share the same completion constraints, including Huddle’s QB-reserve rule and position maximums. ADP and projection are constrained baselines, not an implementation of Yahoo’s undisclosed autodraft or grading algorithm. A future verified Yahoo fixture can supply the common projection input; this run uses synthetic points.', '',
    'The candidate compares shortlists through the next owned pick under two assumed opponent behaviors, conditioned on their observed rosters. It uses no future picks or realization seed. It records alternate sequences for owned turns 5 and 7, corresponding to the early QB2 and TE questions. Those comparisons use the existing bench heuristic and fixed replacement estimates; their gap is a bounded in-model opportunity estimate, not proof of a global optimum.', '',
    '## Release decision', '', `Eligible: **${report.releaseGate.eligible ? 'yes' : 'no'}**. Policy released: **no**.`, '',
    `Paired held-out mean gain: ${report.releaseGate.meanGainPercent ?? 'unavailable'}%. Additional incomplete rosters: ${report.releaseGate.additionalIncompleteRosters ?? 'unavailable'}. Candidate computation deadline misses: ${report.releaseGate.deadlineMisses}.`, '',
    ...Object.entries(report.releaseGate.checks).map(([key, passed]) => `- ${key}: ${passed ? 'passed' : 'not satisfied'}`), '',
    'The five fixture seeds and release thresholds were declared before the first benchmark run. Development and held-out results are separated. Held-out market shifts are synthetic stress cases; they are not independent seasons or observed rooms. No post-result candidate changes can retain the same untouched-holdout claim.', '',
    'The report also preserves ADP-heuristic calibration bins, individual roster legality, pick order, computation times and paired opportunity comparisons. Full browser read/submit/reconcile time is unmeasured here. Historical Maye 387 versus recap 305.96 remain incompatible observations; neither was substituted into this fixture.', '');
  return lines.join('\n');
}
async function main(argv = process.argv.slice(2)) {
  const args = Object.fromEntries(Array.from({ length: Math.ceil(argv.length / 2) }, (_, i) => [argv[i * 2], argv[i * 2 + 1]]));
  for (const key of Object.keys(args)) if (!['--out', '--split', '--fixture'].includes(key)) throw new Error(`Unknown option ${key}`);
  if (!args['--out']) throw new Error('Use --out <new result directory> [--split development|held-out|all] [--fixture <normalized JSON>]');
  const split = args['--split'] || 'all';
  if (!['development', 'held-out', 'all'].includes(split)) throw new Error('Invalid split');
  const output = path.resolve(args['--out']);
  if (fs.existsSync(output)) throw new Error('Use a new result directory to preserve previous experiments');
  const fixtures = args['--fixture'] ? [JSON.parse(fs.readFileSync(path.resolve(args['--fixture']), 'utf8'))]
    : [...(split !== 'held-out' ? manifest.developmentSeeds.map(seed => syntheticFixture(seed, 'development')) : []),
      ...(split !== 'development' ? manifest.heldOutSeeds.map(seed => syntheticFixture(seed, 'held-out')) : [])];
  fixtures.forEach(validateFixture);
  const baseline = loadBaseline(), startedAt = new Date().toISOString(), start = performance.now();
  const sourceFiles = ['manifest.json', 'baseline.js', 'fixtures.js', 'core.js', 'run.js'];
  const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(__dirname, file))).digest('hex')]));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'protocol.json'), JSON.stringify({ startedAt, manifest, sourceHashes, baseline: { commit: baseline.commit, hashes: baseline.sourceHashes } }, null, 2));
  const fixtureHashes = {}, runs = [];
  for (const fixture of fixtures) {
    const fixtureName = `fixture-${fixture.split}-${fixture.seed}.json`;
    fixtureHashes[fixtureName] = validateFixture(fixture);
    fs.writeFileSync(path.join(output, fixtureName), JSON.stringify(fixture, null, 2));
    for (const behavior of manifest.opponents) for (let seat = 1; seat <= fixture.league.teamCount; seat++) {
      for (const policy of manifest.policies) {
        const run = runDraft(fixture, baseline, { behavior, seat, policy });
        runs.push(run); fs.appendFileSync(path.join(output, 'runs.jsonl'), JSON.stringify(run) + '\n');
      }
      process.stdout.write(`${fixture.split} seed ${fixture.seed}, ${behavior}, seat ${seat}: ${runs.length} runs saved\n`);
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  const report = { schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(), durationMs: performance.now() - start,
    scope: 'Offline common-input policy experiment, not live Yahoo or a grading reproduction', baseline: { commit: baseline.commit, hashes: baseline.sourceHashes },
    manifest, sourceHashes, fixtureHashes, summary: summarize(runs), releaseGate: releaseGate(runs), runsFile: 'runs.jsonl',
    historicalGrade: { blitzkrieg: 'C-', theBomb: 'B+', usedForTuning: false, reproducibleGradeFormula: false },
    recording: 'External evidence only; no recording was made or required by this benchmark.' };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'report.md'), markdown(report));
  process.stdout.write(JSON.stringify({ output, runs: runs.length, gate: report.releaseGate, summary: report.summary.map(({ uncalibratedAdpSurvival, ...row }) => row) }, null, 2) + '\n');
}
if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
module.exports = { summarize, markdown, main };
