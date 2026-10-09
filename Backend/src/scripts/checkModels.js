// Usage: npm run models:check
// Lists the Gemini models visible to GEMINI_API_KEY and verifies the configured IDs.
import { loadConfig } from '../config/env.js';
import { createGeminiClient, verifyModels } from '../services/geminiClient.js';

try {
  const config = loadConfig();
  const client = createGeminiClient(config);
  const rows = await verifyModels(client, config);
  let bad = 0;
  for (const r of rows) {
    const ok = r.found && r.supportsAction;
    if (!ok) bad++;
    console.log(`${ok ? 'OK     ' : 'PROBLEM'}  ${r.role.padEnd(9)} ${r.model}  ${r.found ? (r.supportsAction ? '' : `(does not support ${r.action})`) : '(not found for this API key)'}`);
  }
  if (bad) {
    console.log('\nModels this key can use:');
    const pager = await client.models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      if (/gemini/i.test(m.name)) console.log(`  ${String(m.name).replace(/^models\//, '')}  [${(m.supportedActions ?? []).join(', ')}]`);
    }
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
