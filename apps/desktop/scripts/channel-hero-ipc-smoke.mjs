import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Compiled main + actual preload + disk storage, isolated empty userData. No provider generation.
const root = mkdtempSync(join(tmpdir(), 'gws-channel-hero-ipc-'));
app.setPath('userData', root);
delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
async function run() {
  try {
    let win;
    for (let n = 0; n < 150; n++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoadingMainFrame()) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(win); win.hide();
    const evaluate = source => win.webContents.executeJavaScript(`(async()=>{${source}})()`, true);
    for (let n = 0; n < 100; n++) {
      if (await evaluate('return Boolean(window.goldWork?.saveStoryCharacterToChannel)')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const path = join(root, 'accepted.png');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    await writeFile(path, png);
    const result = await evaluate(`
      const api=window.goldWork;
      const input={name:'IPC channel',countryCode:'US',languageCode:'en',languageLabel:'English',masterPrompt:'',direction:'ai-story',defaultMediaMode:'ai',defaultDurationMinutes:10,motionTemplate:'none'};
      const channel=await api.createChannelProfile(input),other=await api.createChannelProfile({...input,name:'Other'});
      const project=await api.createProject({title:'IPC source',topic:'Test',language:'English',aspectRatio:'16:9',mode:'pro',mediaMode:'ai',channelProfileId:channel.id});
      await api.updateProject(project.id,{storyCharacters:[{id:'actor',name:'Sam',aliases:['Main Viewer'],prompt:'White face, green shirt',stylePrompt:'Flat 2D',imagePath:${JSON.stringify(path)},status:'ready'}]});
      const before=JSON.stringify(await api.getProject(project.id));
      const saved=await api.saveStoryCharacterToChannel(project.id,'actor');
      const selected=await api.selectChannelCharacterVersion(channel.id,saved.primaryCharacter.versionId);
      let rejected='';try{await api.selectChannelCharacterVersion(other.id,saved.primaryCharacter.versionId)}catch(e){rejected=String(e)}
      let invalid='';try{await api.generateChannelCharacter(channel.id,{sourceVersionId:saved.primaryCharacter.versionId,name:'',prompt:''})}catch(e){invalid=String(e)}
      const next=await api.createProject({title:'Next',topic:'Test',language:'English',aspectRatio:'16:9',mode:'pro',mediaMode:'ai',channelProfileId:channel.id});
      const used=await api.useChannelCharacterReference(next.id,saved.primaryCharacter.versionId);
      const usedBefore=JSON.stringify(await api.getProject(next.id));
      const removed=await api.deleteChannelCharacterVersion(channel.id,saved.primaryCharacter.versionId);
      let deleteRejected='';try{await api.deleteChannelCharacterVersion(other.id,saved.primaryCharacter.versionId)}catch(e){deleteRejected=String(e)}
      const restored=await api.restoreChannelCharacterVersion(channel.id,saved.primaryCharacter.versionId);
      const reselected=await api.selectChannelCharacterVersion(channel.id,saved.primaryCharacter.versionId);
      return {saved,selected,used,rejected,invalid,removed,restored,reselected,deleteRejected,usedBefore,usedAfter:JSON.stringify(await api.getProject(next.id)),before,after:JSON.stringify(await api.getProject(project.id))};
    `);
    assert.equal(result.before, result.after);
    assert.equal(result.saved.primaryCharacter.name, 'Sam');
    assert.equal(result.used.project.characterReference.imagePath, result.saved.primaryCharacter.imagePath);
    assert.deepEqual(result.used.project.characterReference.aliases, ['Main Viewer']);
    assert.match(result.rejected, /не найдена/);
    assert.match(result.invalid, /Введите имя/);
    assert.match(result.deleteRejected, /не найден/);
    assert.equal(result.removed.primaryCharacter, undefined);
    assert.equal(result.removed.characterVersions.length, 0);
    assert.equal(result.removed.deletedCharacterVersions[0].versionId, result.saved.primaryCharacter.versionId);
    assert.equal(result.restored.primaryCharacter, undefined);
    assert.equal(result.restored.characterVersions[0].versionId, result.saved.primaryCharacter.versionId);
    assert.equal(result.restored.deletedCharacterVersions.length, 0);
    assert.equal(result.reselected.primaryCharacter.versionId, result.saved.primaryCharacter.versionId);
    assert.equal(result.usedBefore, result.usedAfter);
    assert.notEqual(result.saved.primaryCharacter.imagePath, path);
    assert.deepEqual(await readFile(result.saved.primaryCharacter.imagePath), png);
    const profiles = JSON.parse(await readFile(join(root, 'database', 'channel-profiles.json'), 'utf8'));
    assert.equal(profiles.find(p => p.id === result.saved.id).primaryCharacter.versionId, result.saved.primaryCharacter.versionId);
    console.log('PASS: compiled IPC/preload publish, selection/isolation, next-video reuse, delete/restore/reselect, independent disk copy and unchanged existing projects. No live provider calls.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}
