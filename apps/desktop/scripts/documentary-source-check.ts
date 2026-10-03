import { DocumentarySearch } from "../src/documentary-search.js";

const args = process.argv.slice(2);
const query = args.filter(value => !value.startsWith("--")).join(" ") || "SS United States";
const result = await new DocumentarySearch().search({ query, kind: args.includes("--video") ? "video" : "image", providers: args.includes("--archive") ? ["internet-archive"] : ["commons", "loc"], entities: [query] });
console.log(JSON.stringify({ sources: result.sources, count: result.candidates.length,
  sample: result.candidates.slice(0, 5).map(candidate => ({ title: candidate.title, license: candidate.license, rights: candidate.rights, bytes: candidate.bytes, match: candidate.match, concerns: candidate.concerns })) }, null, 2));
if (!result.candidates.length) process.exitCode = 1;
