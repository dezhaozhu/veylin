import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { askUserQuestion, readOpenPage } from './interaction';

const question = {
  question: 'Which scope?',
  header: 'Scope',
  options: [
    { label: 'One', description: '' },
    { label: 'All', description: '' },
  ],
  multiSelect: false,
};

describe('native client tool suspension', () => {
  it('suspends ask_user_question with its input payload', async () => {
    let payload: unknown;
    const result = await (askUserQuestion.execute as any)(
      { questions: [question] },
      {
        agent: {
          suspend: async (value: unknown) => {
            payload = value;
            return undefined;
          },
        },
      },
    );
    assert.equal(result, undefined);
    assert.deepEqual(payload, { questions: [question] });
  });

  it('returns resumed answers as the native tool result', async () => {
    const result = await (askUserQuestion.execute as any)(
      { questions: [question] },
      {
        agent: {
          resumeData: {
            answers: { Scope: 'One' },
            annotations: { Scope: { notes: 'narrow' } },
          },
        },
      },
    );
    assert.deepEqual(result, {
      questions: [question],
      answers: { Scope: 'One' },
      annotations: { Scope: { notes: 'narrow' } },
    });
  });

  it('suspends and resumes read_open_page without changing the tool call', async () => {
    let payload: unknown;
    await (readOpenPage.execute as any)(
      { tabId: 'tab-1', mode: 'text' },
      {
        agent: {
          suspend: async (value: unknown) => {
            payload = value;
          },
        },
      },
    );
    assert.deepEqual(payload, { tabId: 'tab-1', mode: 'text' });

    const page = { mode: 'text', url: 'https://example.test', content: 'hello' };
    assert.deepEqual(
      await (readOpenPage.execute as any)(
        { tabId: 'tab-1', mode: 'text' },
        { agent: { resumeData: page } },
      ),
      page,
    );
  });
});
