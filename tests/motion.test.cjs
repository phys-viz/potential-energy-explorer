const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const html = readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const advanceSource = html.slice(html.indexOf('function advance(h)'), html.indexOf('let nextAnim='));

function simulation(x, v, pauseOutside = true) {
  const state = { x, v, m: 1, E: -x * x + .5 * v * v, view: { xmin: -10, xmax: 10 }, playing: true, pauseReason: null };
  const checkbox = { checked: pauseOutside };
  const advance = runInNewContext(advanceSource + '\nadvance', {
    state, $: () => checkbox, U: x => -x * x, F: x => 2 * x,
    outsideView: () => state.x < state.view.xmin || state.x > state.view.xmax,
    pauseMotion: (kind, text) => { state.pauseReason = { kind, text }; state.playing = false; },
    stop: () => { state.playing = false; },
  });
  return { state, checkbox, advance };
}

test('both edges pause without reflecting velocity or changing energy', () => {
  for (const sign of [-1, 1]) {
    const { state, advance } = simulation(sign * 9.99, sign * 5);
    const energy = state.E;
    advance(.01);
    assert.equal(state.x, sign * 10);
    assert.equal(state.pauseReason.kind, 'edge');
    assert.equal(state.playing, false);
    assert.equal(Math.sign(state.v), sign);
    assert.ok(Math.abs(-(state.x ** 2) + .5 * state.v ** 2 - energy) < 1e-10);
  }
});

test('disabled edge pause allows motion beyond the viewport', () => {
  const { state, advance } = simulation(9.99, 5, false);
  advance(.01);
  assert.ok(state.x > 10);
  assert.equal(state.playing, true);
  assert.equal(state.pauseReason, null);
});

test('enabling edge pause outside the view preserves the current position', () => {
  const { state, advance } = simulation(12, 5);
  advance(.01);
  assert.equal(state.x, 12);
  assert.equal(state.v, 5);
  assert.equal(state.pauseReason.kind, 'edge');
});

test('unbounded motion stops before energy cancellation loses useful precision', () => {
  const { state, advance } = simulation(1.2, 1, false);
  for (let i = 0; i < 10000 && state.playing; i++) advance(.0075);
  assert.equal(state.pauseReason.kind, 'precision');
  assert.ok(Number.isFinite(state.x) && Number.isFinite(state.v));
  assert.ok(Math.abs(-(state.x ** 2) + .5 * state.v ** 2 - state.E) < 1e-6);
});

test('number formatting stays compact for large and small values', () => {
  const source = html.slice(html.indexOf('function scientific(x)'), html.indexOf('function setReading('));
  const fmt = runInNewContext(source + '\nfmt');
  assert.equal(fmt(2.864978268e9), '2.86e+9');
  assert.equal(fmt(-2.951691122e10), '-2.95e+10');
  assert.equal(fmt(1e-9), '1.00e-9');
  assert.equal(fmt(.5), '0.50');
  assert.equal(fmt(0), '0.00');
});
