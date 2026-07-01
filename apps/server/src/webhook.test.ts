import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesEventKey, matchesEventTrigger } from './event-trigger-matcher';
import {
  evaluateWebhookFilter,
  extractEventKey,
  validateWebhookFilter,
} from './webhook-filter';
import {
  parseGithubEventKey,
  verifyWebhookSignature,
} from './webhook-store';

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test';
  const body = Buffer.from('{"hello":"world"}');
  const digest = 'a3c8f8c2c5f1a2d0b5d5d5f5a3b2c1d0e5f5a3b2c1d0e5f5a3b2c1d0e5f5a3';

  it('accepts sha256= prefixed GitHub signatures when digest matches', () => {
    const hex = createHmac('sha256', secret).update(body).digest('hex');
    assert.equal(verifyWebhookSignature(body, `sha256=${hex}`, secret), true);
  });

  it('accepts raw hex signatures', () => {
    const hex = createHmac('sha256', secret).update(body).digest('hex');
    assert.equal(verifyWebhookSignature(body, hex, secret), true);
  });

  it('rejects invalid signatures', () => {
    assert.equal(verifyWebhookSignature(body, digest, secret), false);
  });
});

describe('parseGithubEventKey', () => {
  it('builds type.action keys', () => {
    assert.equal(
      parseGithubEventKey({ action: 'opened' }, 'pull_request'),
      'pull_request.opened',
    );
  });

  it('uses bare type when action is missing', () => {
    assert.equal(parseGithubEventKey({}, 'push'), 'push');
  });
});

describe('matchesEventTrigger', () => {
  it('matches source, event key pattern, and JMESPath filter', () => {
    const payload = { repository: { full_name: 'org/repo' } };
    assert.equal(
      matchesEventTrigger(
        {
          source: 'github',
          on: 'pull_request.*',
          filter: "glob(repository.full_name, 'org/*')",
        },
        'github',
        'pull_request.opened',
        payload,
      ),
      true,
    );
  });

  it('requires explicit source and on patterns', () => {
    assert.equal(
      matchesEventTrigger({ source: 'github', on: 'push' }, 'github', 'push', {}),
      true,
    );
    assert.equal(matchesEventTrigger({ source: 'github' }, 'github', 'push', {}), false);
  });
});

describe('webhook filter helpers', () => {
  it('extracts custom event keys via JMESPath', () => {
    assert.equal(extractEventKey('type', { type: 'issue.created' }), 'issue.created');
  });

  it('validates filter expressions', () => {
    assert.equal(validateWebhookFilter("glob(name, 'a*')").ok, true);
    assert.equal(validateWebhookFilter('???').ok, false);
  });

  it('evaluates glob filters', () => {
    assert.equal(
      evaluateWebhookFilter("glob(repository.full_name, 'org/*')", {
        repository: { full_name: 'org/app' },
      }),
      true,
    );
  });
});

describe('matchesEventKey', () => {
  it('supports wildcard patterns', () => {
    assert.equal(matchesEventKey('pull_request.opened', 'pull_request.*'), true);
    assert.equal(matchesEventKey('issues.opened', 'pull_request.*'), false);
  });
});
