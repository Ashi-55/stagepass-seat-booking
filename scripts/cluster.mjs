import EmbeddedPostgres from 'embedded-postgres';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
export async function localCluster(directory,port){
 const root=resolve(directory);
 mkdirSync(root,{recursive:true});
 const key=join(root,'password');
 if(!existsSync(key))writeFileSync(key,randomBytes(24).toString('hex'),{mode:0o600});
 const password=readFileSync(key,'utf8');
 const databaseDir=join(root,'data');
 const pg=new EmbeddedPostgres({databaseDir,user:'postgres',password,port,authMethod:'scram-sha-256',persistent:true,onLog:()=>{}});
 if(!existsSync(join(databaseDir,'PG_VERSION')))await pg.initialise();
 await pg.start();
 return {pg,url:'postgresql://postgres:'+password+'@127.0.0.1:'+port+'/postgres'};
}
