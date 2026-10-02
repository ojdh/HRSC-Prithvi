// Every R2 call must be charged against the free-tier budget, so only
// lib/r2-budget.ts may touch the bucket binding. See AGENTS.md.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

const BUDGET_MODULE=join('lib','r2-budget.ts');

test('only the R2 budget module touches the bucket binding',async()=>{
  // Arrange: every source file under app/ and lib/
  const files=[];
  for(const dir of ['app','lib'])for(const entry of await readdir(dir,{recursive:true}))if(/\.(ts|tsx|js|mjs)$/.test(entry))files.push(join(dir,entry));
  // Act: find files other than the budget module that mention the binding
  const offenders=[];
  for(const file of files)if(file!==BUDGET_MODULE&&/\bBUCKET\b/.test(await readFile(file,'utf8')))offenders.push(file);
  // Assert
  assert.deepEqual(offenders,[],'Route R2 access through lib/r2-budget.ts instead of env.BUCKET');
});
