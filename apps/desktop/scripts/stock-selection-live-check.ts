// Bounded real-provider check of the two reported bad choices. Existing paid
// checkpoints are reused in place; project edits stay in memory for inspection.
import { app } from "electron";
import { readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MemoryProjectRepository, ProjectService, MockDirectorProvider } from "@gold-work/core";
import type { Project } from "@gold-work/shared";
import { AnyModelStore } from "../src/anymodel-store.js";
import { AnyModelClient } from "../src/anymodel-client.js";
import { StockStore } from "../src/stock-store.js";
import { StockClient } from "../src/stock-client.js";
import { DocumentaryIntelligence } from "../src/documentary-intelligence.js";
import { DocumentaryProjectService } from "../src/documentary-project-service.js";
import { DocumentarySearch } from "../src/documentary-search.js";
import { DocumentaryAnalysisError } from "../src/documentary-analysis-error.js";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { atomicWrite } from "../src/fs-utils.js";

const profile = join(process.env.APPDATA!, "@gold-work", "desktop");
app.setPath("userData", profile);
app.whenReady().then(async () => {
  const numbers = (process.argv.find(arg=>arg.startsWith("--scenes="))?.slice(9) ?? "18,26").split(",").map(Number);
  if(numbers.some(n=>!Number.isInteger(n)||n<1||n>107)||numbers.length>3)throw new Error("Choose at most three existing scene numbers");
  const started = Date.now(), out = resolve("captures/stock-selection-live",numbers.join("-")); let requests = 0;
  await mkdir(out, { recursive: true });
  const registry = await readFile(join(profile, "projects.json"));
  const project = (JSON.parse(registry.toString()) as Project[]).find(p=>p.id==="project_mu8iia3v_qhpe9y9")!;
  project.status = "ready"; // Only this in-memory check; production queue stays untouched.
  const repo = new MemoryProjectRepository(); await repo.save(project);
  const projects = new ProjectService(repo, new MockDirectorProvider());
  const storage = new LocalProjectStorage(join(profile,"workspace","projects"));
  // Do not publish a candidate test as the user's saved project.
  storage.ensureProject = async () => {};
  const client = new AnyModelClient(new AnyModelStore(join(profile,"credentials","anymodel.json")));
  const stock = new StockClient(new StockStore(join(profile,"credentials","stock.json")));
  const root = join(profile,"workspace","Materials");
  const intelligence = new DocumentaryIntelligence(client,id=>storage.projectDirectory(id),async()=>{
    if(requests>=8) throw new DocumentaryAnalysisError("Лимит живой проверки: 8 запросов; готовые результаты сохранены", "unavailable");
    requests++; console.log(JSON.stringify({request:requests,elapsedSeconds:Math.round((Date.now()-started)/1000)}));
  },join(root,"VideoCatalog"));
  let service: DocumentaryProjectService;
  service = new DocumentaryProjectService(projects,storage,new DocumentarySearch(stock,globalThis.fetch,join(profile,"cache","documentary"),query=>service.localCandidates(query)),root,stock,
    progress=>console.log(JSON.stringify({elapsedSeconds:Math.round((Date.now()-started)/1000),stage:progress.message})),intelligence);
  let error: string | undefined;
  try { await service.autoSelect(project.id,{sceneIds:project.scenes.filter(s=>numbers.includes(s.order+1)).map(s=>s.id)}); }
  catch(e) { error=e instanceof Error?e.message:String(e); }
  const updated = (await projects.get(project.id))!;
  await atomicWrite(join(out,"project.json"),JSON.stringify(updated));
  const result={requests,elapsedSeconds:(Date.now()-started)/1000,error,scenes:updated.scenes.filter(s=>numbers.includes(s.order+1)).map(s=>({number:s.order+1,changed:s.videoPath!==project.scenes.find(p=>p.id===s.id)?.videoPath||s.trimStartSeconds!==project.scenes.find(p=>p.id===s.id)?.trimStartSeconds,review:s.documentary?.visualReview,autoError:s.documentary?.autoError}))};
  await atomicWrite(join(out,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  if(!(await readFile(join(profile,"projects.json"))).equals(registry)) throw new Error("Production registry changed during read-only check");
  app.exit(error?1:0);
}).catch(error=>{console.error(String(error));app.exit(1)});
