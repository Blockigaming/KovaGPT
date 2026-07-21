import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

test('search provider centralizes Firecrawl access and source normalization', () => {
  const source = read('src/lib/ai/search.server.ts');
  for (const token of [
    'SearchProviderStatus',
    'WebSource',
    'SearchResponse',
    'searchWeb',
    'formatSearchResultsForPrompt',
    'runWebSearch',
    'dedupeSources',
    'normalizeUrl',
    'FIRECRAWL_API_KEY',
    'KOVA_SEARCH_TIMEOUT_MS',
  ]) {
    assert.match(source, new RegExp(`\\b${token}\\b`), `search provider should include ${token}`);
  }
});

test('chat route uses centralized search provider instead of inline Firecrawl fetch', () => {
  const chat = read('src/routes/api/chat.ts');
  assert.match(chat, /@\/lib\/ai\/search\.server/);
  assert.doesNotMatch(chat, /https:\/\/api\.firecrawl\.dev\/v2\/search/);
});

test('search env example documents timeout without adding a secret', () => {
  const env = read('.env.example');
  assert.match(env, /^FIRECRAWL_API_KEY=$/m);
  assert.match(env, /^KOVA_SEARCH_TIMEOUT_MS=15000$/m);
  assert.doesNotMatch(env, /FIRECRAWL_API_KEY=fc-/);
});
