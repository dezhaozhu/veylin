import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allStepsAnswered,
  ASK_OTHER_OPTION,
  buildAskUserResult,
  hasStepAnswer,
} from './composer-ask-panel-utils';

const questions = [
  {
    question: 'Q1?',
    header: 'Q1',
    options: [{ label: 'A1' }, { label: 'B1' }],
  },
  {
    question: 'Q3?',
    header: 'Q3',
    options: [{ label: 'A3' }, { label: 'B3' }],
  },
];

test('hasStepAnswer rejects empty and unfinished Other', () => {
  assert.equal(hasStepAnswer([], ''), false);
  assert.equal(hasStepAnswer(['A1'], ''), true);
  assert.equal(hasStepAnswer([ASK_OTHER_OPTION], ''), false);
  assert.equal(hasStepAnswer([ASK_OTHER_OPTION], 'custom'), true);
});

test('allStepsAnswered requires every question', () => {
  assert.equal(allStepsAnswered(questions, { 1: ['A3'] }, {}), false);
  assert.equal(allStepsAnswered(questions, { 0: ['A1'], 1: ['A3'] }, {}), true);
});

test('buildAskUserResult maps picks to answers', () => {
  const result = buildAskUserResult(questions, { 0: ['A1'], 1: ['A3'] }, {});
  assert.equal(result.answers['Q1?'], 'A1');
  assert.equal(result.answers['Q3?'], 'A3');
});
