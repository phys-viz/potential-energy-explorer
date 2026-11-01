const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

// Exercise the parser shipped in the standalone page without a browser dependency.
const html = readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('function compile(s)'), html.indexOf('function equationError('));
const compile = runInNewContext(source + '\ncompile', {
  state: { view: { xmin: 0, xmax: 10 } },
});

test('negative powers follow mathematical precedence', () => {
  for (const [equation, expected] of [
    ['-x^2', -9], ['-x**2', -9], ['-(x^2)', -9],
    ['(-x)^2', 9], ['-2*x^2+1', -17],
    ['x^-2', 1 / 9], ['x^(-2)', 1 / 9], ['2^-x', 1 / 8],
    ['2^3^2', 512], ['-x^2^2', -81], ['--x^2', 9],
  ]) {
    assert.ok(Math.abs(compile(equation)(3) - expected) < 1e-10, equation);
  }
});

test('existing curves, standard functions, constants and numeric notation still work', () => {
  for (const [equation, expected] of [
    ['0.12*(x-2)^2*(x-7)^2+1', 2.92],
    ['sin(PI/2)+cos(0)+log(E)', 3],
    ['max(-x^2, min(2, pow(x,2)))', 2],
    ['abs(-x)+sqrt(x^2)', 6],
    ['1e-3*x + .5 + 2.', 2.503],
    ['  x / 2 * 4 - 1  ', 5],
  ]) {
    assert.ok(Math.abs(compile(equation)(3) - expected) < 1e-10, equation);
  }
});

test('malformed and undefined equations are rejected with usable errors', () => {
  for (const equation of ['', '-x^', '(x+2', 'x)', '2x', 'sin x', 'sin()', 'unknown(x)', 'x;alert(1)', 'x.constructor', 'sqrt(-1)']) {
    assert.throws(() => compile(equation), /equation|Expected|Unexpected|Unrecognized|Use only/, equation);
  }
});

test('the default equation resembles the original registration-point curve', () => {
  const expression = html.match(/<textarea[^>]*id="equation"[^>]*>([\s\S]*?)<\/textarea>/)[1];
  const potential = compile(expression);
  for (const [x, original] of [[.18, 8.7], [1.2, 4.1], [2.35, 1.05], [5.12, 5.55], [7.35, 2.36], [9.7, 9.4]]) {
    assert.ok(Math.abs(potential(x) - original) < .3, `curve height at x=${x}`);
  }
  // Preserve both wells and the central barrier in the equation approximation.
  assert.ok(potential(2.48) < potential(2.3) && potential(2.48) < potential(2.7));
  assert.ok(potential(5.12) > potential(4.9) && potential(5.12) > potential(5.4));
  assert.ok(potential(7.48) < potential(7.2) && potential(7.48) < potential(7.7));
});
