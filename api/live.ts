import {Client} from 'pg';
import type {ServerResponse} from 'node:http';

// One PostgreSQL listener per warm API instance, shared by its open browsers.
const streams=new Set<ServerResponse>();
let listener:Client|undefined;
let connecting:Promise<void>|undefined;

function stop(client:Client){
  if(listener!==client)return;
  listener=undefined;
  connecting=undefined;
  for(const stream of streams)stream.end();
  void client.end().catch(()=>{});
}

function listen(){
  if(connecting)return connecting;
  const url=new URL(process.env.LISTEN_DATABASE_URL||process.env.DATABASE_URL!);
  // LISTEN is session-scoped. Use the session port on Supabase's shared pooler.
  if(url.hostname.endsWith('.pooler.supabase.com') && url.port==='6543')url.port='5432';
  const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
  listener=client;
  client.on('error',()=>stop(client));
  client.on('end',()=>stop(client));
  client.on('notification',()=>{
    for(const stream of streams)stream.write('data: change\n\n');
  });
  connecting=(async()=>{
    await client.connect();
    await client.query('LISTEN stagepass_change');
  })();
  return connecting;
}

export async function streamChanges(res:ServerResponse){
  try{await listen();}
  catch{if(listener)stop(listener);res.writeHead(503);res.end();return;}
  if(res.destroyed){if(!streams.size && listener)stop(listener);return;}
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'private, no-cache, no-transform','X-Accel-Buffering':'no'});
  streams.add(res);
  res.write('retry: 1500\ndata: ready\n\n');
  const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),10000);
  const renew=setTimeout(()=>res.end(),50000);
  res.once('close',()=>{
    clearInterval(heartbeat);clearTimeout(renew);streams.delete(res);
    if(!streams.size && listener)stop(listener);
  });
}
