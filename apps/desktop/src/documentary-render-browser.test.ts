import test from 'node:test';
import assert from 'node:assert/strict';
import {openDocumentaryRenderBrowser} from './documentary-renderer.js';

test('a failed system Chrome falls back once and clears its failed executable from render options',async()=>{
 const calls:unknown[]=[];
 const instance={close:async()=>{}};
 const result=await openDocumentaryRenderBrowser(process.execPath,undefined,(async(_browser:unknown,options:unknown)=>{
  calls.push(options);if(calls.length===1)throw new Error('Browser closed with code 0');return instance;
 }) as never);
 assert.deepEqual(calls,[{browserExecutable:process.execPath,chromeMode:'chrome-for-testing'},{chromeMode:'headless-shell'}]);
 assert.equal(result.instance,instance);assert.deepEqual(result.options,{chromeMode:'headless-shell'});
});

test('a successful primary and a cancelled launch never create a second browser',async()=>{
 let calls=0;
 await openDocumentaryRenderBrowser(process.execPath,undefined,(async()=>{calls++;return {};}) as never);
 assert.equal(calls,1);
 const controller=new AbortController();calls=0;
 await assert.rejects(openDocumentaryRenderBrowser(process.execPath,controller.signal,(async()=>{
  calls++;controller.abort();throw new Error('Browser launch interrupted');
 }) as never));
 assert.equal(calls,1);
});

test('failure of both browsers is bounded and retains both causes',async()=>{
 let calls=0;
 await assert.rejects(openDocumentaryRenderBrowser(process.execPath,undefined,(async()=>{calls++;throw new Error(`launch ${calls}`);}) as never),
  error=>error instanceof AggregateError&&error.errors.length===2);
 assert.equal(calls,2);
});

test('a missing configured executable is bypassed before Remotion can retain its rejected check',async()=>{
 const calls:unknown[]=[];
 await openDocumentaryRenderBrowser('D:/GoldWork-missing-browser-fixture.exe',undefined,(async(_browser:unknown,options:unknown)=>{calls.push(options);return {};}) as never);
 assert.deepEqual(calls,[{chromeMode:'headless-shell'}]);
});
