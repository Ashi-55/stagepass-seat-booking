import {build} from 'esbuild';
import {mkdir,copyFile,cp} from 'node:fs/promises';
await mkdir('dist/web',{recursive:true});
await Promise.all([
 build({entryPoints:['web/main.ts'],bundle:true,target:'es2016',minify:true,outfile:'dist/web/app.js',loader:{'.html':'text'}}),
 build({entryPoints:['api/main.ts','api/store.ts'],platform:'node',bundle:true,packages:'external',outdir:'dist/api',format:'cjs'}),
 copyFile('web/index.html','dist/web/index.html'),copyFile('public/style.css','dist/web/style.css')
]);


await cp('web/media','dist/web/media',{recursive:true});
for(const [font,weight] of [['barlow-condensed',700],['dm-sans',400],['dm-sans',600]]){
 const file=font+'-latin-'+weight+'-normal.woff2';
 await copyFile('node_modules/@fontsource/'+font+'/files/'+file,'dist/web/media/'+file);
}
await cp('web/install','dist/web/install',{recursive:true});
await copyFile('web/service-worker.js','dist/web/service-worker.js');
