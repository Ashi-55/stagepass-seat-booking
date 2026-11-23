import {mkdir,copyFile,cp,writeFile,readFile} from 'node:fs/promises';
const dir='dist/vercel';
await mkdir(dir+'/api',{recursive:true});
await mkdir(dir+'/db',{recursive:true});
await cp('dist/web',dir+'/site',{recursive:true});
await copyFile('db/schema.sql',dir+'/db/schema.sql');
await copyFile('db/supabase-prod-ca.crt',dir+'/db/supabase-prod-ca.crt');
await copyFile('dist/api/main.js',dir+'/server.cjs');
const pkg=JSON.parse(await readFile('package.json','utf8'));
const deps=Object.fromEntries(Object.entries(pkg.dependencies).filter(([name])=>name.startsWith('@nestjs/')||['reflect-metadata','rxjs','pg'].includes(name)));
await writeFile(dir+'/package.json',JSON.stringify({name:'stagepass-booking',private:true,dependencies:deps}));
await writeFile(dir+'/vercel.json',JSON.stringify({framework:null,regions:['hnd1'],buildCommand:null,outputDirectory:'site',functions:{'api/booking.js':{includeFiles:'db/**'}},rewrites:[{source:'/api/:operation',destination:'/api/booking?operation=:operation'}]}));
await copyFile('scripts/vercel-handler.cjs',dir+'/api/booking.js');

