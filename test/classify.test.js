import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize,
  isSensitiveField,
  detectRemoteBrowserRequirement,
  isSafeNavigationButton,
  isFinalSubmitButton,
  inferProfileKey
} from '../src/classify.js';

test('normalizes labels consistently', () => {
  assert.equal(normalize('  Desired Salary ($) '), 'desired salary');
});

test('flags sensitive application fields', () => {
  assert.equal(isSensitiveField({ label: 'Disability status' }), true);
  assert.equal(isSensitiveField({ label: 'First name' }), false);
});

test('detects bot or verification challenges', () => {
  assert.ok(detectRemoteBrowserRequirement({ body: 'Please verify you are human to continue' }));
  assert.equal(detectRemoteBrowserRequirement({ body: 'Apply for this marketing role' }), null);
});

test('separates navigation from final submission', () => {
  assert.equal(isSafeNavigationButton('Continue'), true);
  assert.equal(isSafeNavigationButton('Submit Application'), false);
  assert.equal(isFinalSubmitButton('Submit Application'), true);
  assert.equal(isFinalSubmitButton('Continue'), false);
});

test('infers safe profile keys', () => {
  assert.equal(inferProfileKey({ label: 'First Name' }), 'first_name');
  assert.equal(inferProfileKey({ label: 'LinkedIn Profile URL' }), 'linkedin');
  assert.equal(inferProfileKey({ label: 'Desired salary' }), null);
});
