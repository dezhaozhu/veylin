import { expect, test } from '@playwright/test';

const sampleQuestions = [
  {
    question: '你更喜欢哪种语言？',
    header: '语言',
    options: [{ label: 'JavaScript' }, { label: 'Python' }, { label: 'Go' }],
  },
];

test.describe('Composer ask panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () =>
        document.body.innerText.includes('问点什么') ||
        document.body.innerText.includes('发送消息') ||
        document.body.innerText.includes('Send'),
    );
    await page.waitForFunction(() => window.__veylinTest?.hasThread?.());
    await page.evaluate((questions) => {
      window.__veylinTest!.clearAskResult();
      window.__veylinTest!.openAskPanel(questions);
    }, sampleQuestions);
    await expect(page.getByText(/1\s+of\s+1/i)).toBeVisible();
  });

  test('option click then manual submit closes the panel', async ({ page }) => {
    const option = page.getByRole('button', { name: /JavaScript/ });
    await expect(option).toBeVisible();

    const hitTarget = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((node) =>
        node.textContent?.includes('JavaScript'),
      );
      if (!button) return { found: false as const };
      const rect = button.getBoundingClientRect();
      const top = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        found: true as const,
        hitsOption: top === button || button.contains(top),
      };
    });
    expect(hitTarget.found).toBe(true);
    expect(hitTarget.hitsOption).toBe(true);

    await option.click();
    await expect(page.getByText(/1\s+of\s+1/i)).toBeVisible();

    const submit = page.getByRole('button', { name: /提交|Submit/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText(/1\s+of\s+1/i)).toBeHidden({ timeout: 5000 });
  });
});

declare global {
  interface Window {
    __veylinTest?: {
      hasThread: () => boolean;
      openAskPanel: (questions: typeof sampleQuestions) => void;
      peekAskResult: () => { answers: Record<string, string> } | null;
      clearAskResult: () => void;
    };
  }
}
