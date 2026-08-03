import { z } from 'zod';

/**
 * LLM-tolerant boolean. Models (kimi et al.) often send booleans as strings
 * ("true"/"false"/"1"/"0"). z.coerce.boolean() is a footgun here — it uses JS
 * truthiness, so the string "false" coerces to `true`. This maps the common
 * string forms explicitly and leaves real booleans untouched; anything else
 * falls through to z.boolean() and fails validation as it should.
 *
 * Note (zod v4): the parsed value is a real boolean at runtime, but the schema's
 * INPUT type is `unknown`, so call sites that pass the value into a typed slot
 * may need a Boolean()/cast to narrow.
 */
export function llmBool() {
  return z.preprocess((v) => {
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === '') return false;
    }
    return v;
  }, z.boolean());
}
