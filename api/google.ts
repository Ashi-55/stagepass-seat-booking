import {createHash,randomBytes} from 'node:crypto';
import {HttpException} from '@nestjs/common';

function config(){
  const origin=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!origin || !key)throw new HttpException('Google sign-in is awaiting provider configuration.',503);
  return {auth:new URL('/auth/v1/',origin),key};
}

export function startGoogle(){
  const {auth}=config();
  const verifier=randomBytes(48).toString('base64url');
  const url=new URL('authorize',auth);
  url.search=new URLSearchParams({
    provider:'google',
    redirect_to:process.env.STAGE_AUTH_REDIRECT_URL || (process.env.VERCEL?'https://stagepass-seat-booking.vercel.app/':'http://127.0.0.1:8125/'),
    code_challenge:createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method:'s256'
  }).toString();
  return {verifier,url:url.href};
}

export async function finishGoogle(code:unknown,verifier:string|undefined){
  if(typeof code!=='string'||!code||code.length>2048||!verifier)throw new HttpException('Open Google sign-in again in this browser.',400);
  const {auth,key}=config();
  const response=await fetch(new URL('token?grant_type=pkce',auth),{
    method:'POST',headers:{apikey:key,'Content-Type':'application/json'},
    body:JSON.stringify({auth_code:code,code_verifier:verifier}),signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new HttpException('Google sign-in expired or was declined. Please try again.',401);
  const {user}=await response.json();
  const identity=user?.identities?.find((i:{provider:string})=>i.provider==='google');
  const subject=identity?.identity_data?.sub;
  if(typeof subject!=='string'||!subject||typeof user.email!=='string'||!user.email_confirmed_at)throw new HttpException('A verified Google account is required.',401);
  return {subject,email:user.email};
}
