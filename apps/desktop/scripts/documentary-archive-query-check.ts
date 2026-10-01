import { writeFile } from 'node:fs/promises';
import { DocumentarySearch } from '../src/documentary-search.js';

const search = new DocumentarySearch();
const results = [];
for (const query of ['"Atlantic Queen"', '"Superliner" "United States"', '"United States" "maiden"']) {
  const result = await search.search({ query, kind: 'video', providers: ['internet-archive'], entities: [query.includes('Icon') ? 'Icon of the Seas' : 'SS United States'] });
  results.push({ query, result });
  console.log(JSON.stringify({ query, sources: result.sources, candidates: result.candidates.map(({ title, rights, bytes, description }) => ({ title, rights, bytes, description: description.slice(0, 220) })) }));
}
await writeFile('captures/documentary-archive-query-check.json', JSON.stringify(results, null, 2));
