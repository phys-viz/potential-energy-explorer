const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const html = readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const advanceSource = html.slice(html.indexOf('function verletStep('), html.indexOf('let nextAnim='));

function simulation(x, v, pauseOutside = true, { potential = x => -x * x, force = x => 2 * x, mass = 1 } = {}) {
  const energy = potential(x) + .5 * mass * v * v;
  const state = { x, v, m: mass, E: energy, referenceE: energy, energyScale: Math.max(1, Math.abs(energy)), simTime: 0, view: { xmin: -10, xmax: 10 }, playing: true, pauseReason: null };
  const checkbox = { checked: pauseOutside };
  const advance = runInNewContext(advanceSource + '\nadvance', {
    state, $: () => checkbox, U: potential, F: force,
    outsideView: () => state.x < state.view.xmin || state.x > state.view.xmax,
    pauseMotion: (kind, text) => { state.pauseReason = { kind, text }; state.playing = false; },
    stop: () => { state.playing = false; },
  });
  return { state, checkbox, advance };
}

test('both edges use the crossing time without reflecting velocity', () => {
  for (const sign of [-1, 1]) {
    const { state, advance } = simulation(sign * 9.99, sign * 5);
    const energy = state.E;
    advance(.01);
    assert.equal(state.x, sign * 10);
    assert.equal(state.pauseReason.kind, 'edge');
    assert.equal(state.playing, false);
    assert.equal(Math.sign(state.v), sign);
    assert.ok(Math.abs(state.E - energy) < 1e-5);
    assert.ok(state.simTime > 0 && state.simTime < .01);
    assert.equal(state.E, -(state.x ** 2) + .5 * state.v ** 2);
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

test('unbounded motion stops on energy drift without projecting the speed', () => {
  const { state, advance } = simulation(1.2, 1, false);
  for (let i = 0; i < 10000 && state.playing; i++) advance(.0075);
  assert.equal(state.pauseReason.kind, 'precision');
  assert.ok(Number.isFinite(state.x) && Number.isFinite(state.v));
  const error = Math.abs(state.E - state.referenceE);
  assert.ok(error <= .01 * state.energyScale);
  assert.ok(error > .009 * state.energyScale);
  assert.equal(state.E, -(state.x ** 2) + .5 * state.v ** 2);
});

test('constant force matches exact motion and the velocity coefficient', () => {
  const { state, advance } = simulation(0, 3, false, { potential: x => -4 * x, force: () => 4, mass: 2 });
  for (let i = 0; i < 400; i++) advance(.005);
  assert.ok(Math.abs(state.x - 10) < 1e-10);
  assert.ok(Math.abs(state.v - 7) < 1e-10);
  assert.ok(Math.abs(state.E - state.referenceE) < 1e-10);
});

function oscillator(mass = 1) {
  return simulation(1, 0, false, { potential: x => 2 * x * x, force: x => -4 * x, mass });
}

test('harmonic oscillator period and bounded energy match known solutions for two masses', () => {
  for (const mass of [1, 4]) {
    const { state, advance } = oscillator(mass);
    const exactPeriod = 2 * Math.PI * Math.sqrt(mass / 4), crossings = [], step = .005;
    let peakError = 0;
    while (state.simTime < 100 * exactPeriod) {
      const lastX = state.x, lastTime = state.simTime;
      advance(step);
      assert.equal(state.pauseReason, null);
      if (lastX > 0 && state.x <= 0) crossings.push(lastTime + step * lastX / (lastX - state.x));
      peakError = Math.max(peakError, Math.abs(state.E - state.referenceE) / state.referenceE);
    }
    assert.ok(crossings.length >= 99);
    const period = (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
    const relativePeriodError = Math.abs(period / exactPeriod - 1);
    assert.ok(relativePeriodError < 5e-6, `period error ${relativePeriodError}, mass=${mass}`);
    assert.ok(peakError < 2.6e-5, `peak energy error ${peakError}, mass=${mass}`);
    assert.ok(peakError > 1e-7, 'energy is measured rather than forced constant');
    console.log(`m=${mass}: period error ${(relativePeriodError * 100).toFixed(6)}%; peak energy drift ${(peakError * 100).toFixed(6)}% over 100 periods`);
  }
});

test('halving the timestep reduces oscillator trajectory error by about four', () => {
  const errors = [.02, .01].map(step => {
    const { state, advance } = oscillator();
    const total = 2;
    for (let i = 0; i < Math.round(total / step); i++) advance(step);
    return Math.abs(state.x - Math.cos(2 * total));
  });
  assert.ok(errors[0] / errors[1] > 3.9 && errors[0] / errors[1] < 4.1);
});

test('equation force is independent of the displayed position range', () => {
  const source = html.slice(html.indexOf('function derivativeStep('), html.indexOf('function projectX('));
  const state = { mode: 'equation', view: { xmin: 0, xmax: 10 } };
  const force = runInNewContext(source + '\nF', { state, U: x => 2 * x * x });
  const initial = force(3);
  state.view = { xmin: -1e6, xmax: 1e6 };
  assert.equal(force(3), initial);
  assert.ok(Math.abs(initial + 12) < 1e-7);
});

test('animation uses fixed 5 ms steps at each playback speed', () => {
  const frameSource = html.slice(html.indexOf('let nextAnim='), html.indexOf('function startAnimation('));
  for (const speed of [.25, 1, 2]) {
    const state = { playing: true, t0: null, nudge: null, stepRemainder: 0 };
    const steps = [];
    const frame = runInNewContext(frameSource + '\nframe', {
      state, PHYSICS_STEP: .005, num: () => speed,
      advance: h => steps.push(h), requestAnimationFrame: () => {},
      updateStats: () => {}, syncPlay: () => {}, draw: () => {},
    });
    frame(0);
    for (let ms = 17; ms < 1000; ms += 17) frame(ms);
    frame(1000);
    assert.ok(steps.every(h => h === .005));
    const simulated = steps.reduce((sum, h) => sum + h, 0);
    assert.ok(Math.abs(simulated - speed) <= .005 + 1e-12);
  }
});

test('readouts stay in decimal format through zero and compact for large values', () => {
  const source = html.slice(html.indexOf('function scientific(x)'), html.indexOf('function setReading('));
  const fmt = runInNewContext(source + '\nfmt');
  assert.equal(fmt(2.864978268e9), '2.86e+9');
  assert.equal(fmt(-2.951691122e10), '-2.95e+10');
  assert.equal(fmt(1e-9), '0.00');
  assert.equal(fmt(-1e-9), '0.00');
  assert.equal(fmt(.0049), '0.00');
  assert.equal(fmt(-.0049), '0.00');
  assert.equal(fmt(.0051), '0.01');
  assert.equal(fmt(-.0051), '-0.01');
  assert.equal(fmt(.5), '0.50');
  assert.equal(fmt(0), '0.00');
});
