import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canSelectDifferentMinor,
  isExactRange,
  runtimeMatchesCompiler,
  sameMinor,
  sameVersion,
  satisfies,
} from '../src/semver.js';

describe('semver', () => {
  it('treats 0.23 and 0.23.0 as the same minor', () => {
    assert.equal(sameMinor('0.23', '0.23.0'), true);
    assert.equal(sameVersion('0.23', '0.23.0'), true);
  });

  it('keeps caret on 0.x inside the minor', () => {
    assert.equal(satisfies('^0.16.0', '0.16.0'), true);
    assert.equal(satisfies('^0.16.0', '0.16.9'), true);
    assert.equal(satisfies('^0.16.0', '0.17.0'), false);
    assert.equal(satisfies('^0.16.0', '0.15.0'), false);
    assert.equal(canSelectDifferentMinor('^0.16.0', '0.16.0'), false);
  });

  it('treats a star range as able to leave the minor', () => {
    assert.equal(satisfies('*', '0.20.0'), true);
    assert.equal(canSelectDifferentMinor('*', '0.16.0'), true);
    assert.equal(satisfies('>=0.16.0', '0.20.0'), true);
  });

  it('lets a 1.x caret move minor and not major', () => {
    assert.equal(satisfies('^4.0.4', '4.1.1'), true);
    assert.equal(satisfies('^4.1.1', '5.0.0'), false);
  });

  it('recognizes exact ranges', () => {
    assert.equal(isExactRange('0.16.0'), true);
    assert.equal(isExactRange('^0.16.0'), false);
    assert.equal(isExactRange('*'), false);
  });

  it('treats compact-runtime minors as breaking', () => {
    assert.equal(runtimeMatchesCompiler('0.16.0', '0.16.1'), true);
    assert.equal(runtimeMatchesCompiler('0.16.0', '0.15.0'), false);
    assert.equal(runtimeMatchesCompiler('0.20.0', '0.19.0'), false);
  });
});
