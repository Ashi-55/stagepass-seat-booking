import 'reflect-metadata';
import {Body,Controller,Get,Headers,HttpException,Module,Param,Post,Res} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import {Pool} from 'pg';
import {resolve} from 'node:path';
import {startGoogle,finishGoogle} from './google';
import {streamChanges} from './live';
import type {ServerResponse} from 'node:http';
import {Store, Command} from './store';

const connectionString=process.env.DATABASE_URL;

const db=new Store(new Pool({connectionString,max:3,connectionTimeoutMillis:8000}));
function token(cookie=''){return /(?:^|;\s*)stagepass=([a-f0-9]{64})(?:;|$)/.exec(cookie)?.[1]??'';}

@Controller('api')
class BookingController{
  @Get('changes') async changes(@Headers('cookie') cookie:string,@Res() res:ServerResponse){
    await db.run('authorize',{},token(cookie));
    return streamChanges(res);
  }
  @Get('state') state(@Headers('cookie') cookie:string){return db.run('state',{},token(cookie));}
  @Post(':operation') async command(@Param('operation') op:string,@Body() body:Command & {code?:string},@Headers('cookie') cookie:string,@Headers('content-type') type:string,@Res({passthrough:true}) res:{cookie:Function;clearCookie:Function}){
    if(!type?.startsWith('application/json')||!body||typeof body!=='object'||Array.isArray(body))throw new HttpException('Expected JSON object.',400);
    const secure=process.env.VERCEL==='1'||process.env.COOKIE_SECURE==='true';
    if(op==='google-start'){
      const {url,verifier}=startGoogle();
      res.cookie('stagepass_pkce',verifier,{httpOnly:true,sameSite:'lax',secure,maxAge:600000,path:'/api'});
      return {url};
    }
    if(op==='google-finish'){
      const verifier=/(?:^|;\s*)stagepass_pkce=([A-Za-z0-9_-]{64})(?:;|$)/.exec(cookie||'')?.[1];
      res.clearCookie('stagepass_pkce',{path:'/api'});
      const {subject,email}=await finishGoogle(body.code,verifier);
      const {session}=await db.googleSession(subject,email);
      res.cookie('stagepass',session,{httpOnly:true,sameSite:'strict',secure,maxAge:30*86400000,path:'/'});
      return {};
    }
    if(!['admin-accounts','create-organizer','open','guest','register','login','logout','events','edit','hold','confirm','cancel'].includes(op))throw new HttpException('Unknown operation.',404);
    for(const key of ['id','event'] as const)if(body[key]!==undefined&&!Number.isSafeInteger(body[key])) throw new HttpException('Invalid identifier.',400);
    const existing=token(cookie);
    const result=await db.run(op==='open'?'guest':op,body,existing);
    if(result.session){res.cookie('stagepass',result.session,{httpOnly:true,sameSite:'strict',secure:(process.env.VERCEL==='1'||process.env.COOKIE_SECURE==='true'),maxAge:30*86400000,path:'/'});}
    if(op==='open')return db.run('state',{},result.session||existing);
    if(result.session)return {};
    if(op==='logout')res.clearCookie('stagepass');return result;
  }
}
@Module({controllers:[BookingController]}) class AppModule{}
export async function createApp(){
  if(!connectionString)throw Error('Missing DATABASE_URL');
  await db.init(process.env.STAGE_ORGANIZER_PASSWORD??'',process.env.STAGE_ADMIN_PASSWORD);
  const app=await NestFactory.create<NestExpressApplication>(AppModule);
  return app;
}
async function main(){
  const app=await createApp();
  app.useStaticAssets(resolve('dist/web'));
  await app.listen(Number(process.env.PORT??8125),'127.0.0.1');
}
if(require.main===module)main().catch(e=>{console.error('Startup failed:',e.code??e.name,e.message.replace(/postgres(?:ql)?:\/\/\S+/gi,'[connection]'));process.exit(1);});
