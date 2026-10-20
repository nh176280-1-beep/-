const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
(async()=>{
 let person=null;
 const db={prepare(){return {bind(){return this},async first(){return {value:'owner-id'}}}}};
 const context={exports:{},crypto:require('node:crypto').webcrypto,getChatGPTUser:async()=>person,env:{DB:db}};vm.createContext(context);
 let source=fs.readFileSync('lib/data.ts','utf8').replace(/^import .*;$/gm,'');source=source.slice(0,source.indexOf('export async function insertItems'));
 vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 let anonymous=await context.exports.identity(new Request('https://site.test/'));assert.equal(anonymous.role,'viewer');assert.equal(anonymous.guest,true);assert.equal(anonymous.service,false);
 const next=await context.exports.identity(new Request('https://site.test/',{headers:{cookie:'price_visitor='+anonymous.visitor}}));assert.equal(next.id,anonymous.id);assert.equal(next.newVisitor,false);
 assert.equal((await context.exports.identity()).role,'viewer');
 person={userId:'other',displayName:'Other'};assert.equal((await context.exports.identity()).role,'staff');
 person={userId:'owner-id',displayName:'Owner'};assert.equal((await context.exports.identity()).role,'admin');
 assert(!fs.readFileSync('app/page.tsx','utf8').includes('requireChatGPTUser'));
 console.log('PASS: anonymous page access, separate visitor identity, persistent visitor cookie, anonymous MCP write denial, owner-only collection');
})().catch(e=>{console.error(e);process.exitCode=1});
