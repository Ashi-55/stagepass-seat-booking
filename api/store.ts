import {Pool, PoolClient} from 'pg';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {HttpException} from '@nestjs/common';

function check(ok:unknown,message:string,status=400): asserts ok {
  if(!ok) throw new HttpException(message,status);
}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function passwordHash(password:string,salt=randomBytes(16).toString('hex')){
  return salt+':'+scryptSync(password,salt,32).toString('hex');
}
export interface Command {name?:string;password?:string;id?:number;venue?:string;date?:number;rows?:number;cols?:number;maximum?:number;minutes?:number;seats?:string[];event?:number}
export class Store {
  constructor(readonly pool:Pool,readonly clock=()=>Date.now()/1000){}
  async tx<T>(work:(db:PoolClient)=>Promise<T>){
    const db=await this.pool.connect();
    try{
      await db.query('BEGIN');
      await db.query('SET LOCAL search_path TO stagepass');
      const result=await work(db);
      await db.query('COMMIT');return result;
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }
  async init(organizerPassword:string,adminPassword?:string){
    await this.tx(async db=>{
      await db.query('SELECT pg_advisory_xact_lock(36041827)');
      await db.query(readFileSync('db/schema.sql','utf8'));
      if((await db.query('SELECT 1 FROM users LIMIT 1')).rowCount)return;
      check(organizerPassword.length>=8,'Set an organizer password of at least eight characters.');
      await db.query("INSERT INTO users(name,password,role) VALUES ('organizer',$1,'organizer')",[passwordHash(organizerPassword)]);
      const sample=(await db.query("INSERT INTO users(name,password,role) VALUES ('Sample audience',$1,'attendee') RETURNING id",[passwordHash(randomBytes(32).toString('hex'))])).rows[0].id;
      for(const [i,name] of ['Midnight Frequencies','Blue Hour Sessions'].entries()){
        const cols=i?10:12;
        const event=(await db.query('INSERT INTO events(name,venue,date,rows,cols,genre) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',[name,i?'Studio Meridian':'The Foundry Hall',this.clock()+(14+i*7)*86400,i?6:10,cols,i?'Jazz':'Electronic'])).rows[0].id;
        for(let k=0;k<15;k++){
          const n=(7*k+2)%(i?60:120),seat=String.fromCharCode(65+Math.floor(n/cols))+(n%cols+1);
          const rid=(await db.query("INSERT INTO reservations(event,owner,status,seats) VALUES($1,$2,'booked',$3) RETURNING id",[event,sample,[seat]])).rows[0].id;
          await db.query('INSERT INTO claims VALUES($1,$2,$3)',[event,seat,rid]);
        }
      }
    });
    if(adminPassword){
      await this.tx(async db=>{
        await db.query('SELECT pg_advisory_xact_lock(36041827)');
        const existing=await db.query("SELECT role FROM users WHERE name='admin'");
        if(existing.rowCount){
          check(existing.rows[0].role==='admin','The bootstrap admin name is already in use.');
          return;
        }
        check(adminPassword.length>=12,'Use at least twelve characters for the admin password.');
        await db.query("INSERT INTO users(name,password,role) VALUES ('admin',$1,'admin')",[passwordHash(adminPassword)]);
      });
    }
  }
  async googleSession(subject:string,email:string){
    return this.tx(async db=>{
      await db.query('SELECT pg_advisory_xact_lock(36041827)');
      const found=await db.query('SELECT id FROM users WHERE google_subject=$1',[subject]);
      let owner=found.rows[0]?.id;
      if(!owner){
        const preferred=email.slice(0,64);
        const taken=await db.query('SELECT 1 FROM users WHERE name=$1',[preferred]);
        const name=taken.rowCount?preferred.slice(0,48)+'-'+randomBytes(6).toString('hex'):preferred;
        const created=await db.query("INSERT INTO users(name,password,google_subject,role) VALUES($1,'',$2,'attendee') RETURNING id",[name,subject]);
        owner=created.rows[0].id;
      }
      return this.session(db,owner,this.clock());
    });
  }
  private async session(db:PoolClient,id:number,now:number){
    const session=randomBytes(32).toString('hex');
    await db.query('INSERT INTO sessions VALUES($1,$2,$3)',[hash(session),id,now+30*86400]);
    return {session};
  }
  async run(path:string,d:Command={},token=''){
    return this.tx(async db=>{
      // All state transitions use the same transaction lock, including expiry and grid edits.
      await db.query('SELECT pg_advisory_xact_lock(36041827)');
      const now=this.clock();
      await db.query("WITH expired AS (UPDATE reservations SET status='expired' WHERE status='held' AND expires<=$1 RETURNING id) DELETE FROM claims USING expired WHERE claims.reservation=expired.id",[now]);
      const user=(await db.query('SELECT u.id,u.name,u.role,u.guest FROM sessions s JOIN users u ON u.id=s.owner WHERE s.token=$1 AND s.expires>$2',[hash(token),now])).rows[0];
      if(['guest','register','login'].includes(path)){
        if(path==='guest' && user)return {};
        let id:number;
        if(path==='guest'){
          id=(await db.query("INSERT INTO users(name,password,role,guest) VALUES ($1,'','attendee',true) RETURNING id",['Guest-'+randomBytes(12).toString('hex')])).rows[0].id;
        }else{
          check(typeof d.name==='string' && d.name.trim().length>0 && d.name.length<=64 && typeof d.password==='string' && d.password.length<=256,'Enter a name and password.');
          const name=d.name.trim();
          if(path==='register'){
            check(name.toLowerCase()!=='admin','Name already taken.',409);
            check(d.password.length>=8,'Use at least eight password characters.');
            const result=await db.query("INSERT INTO users(name,password,role) VALUES ($1,$2,'attendee') ON CONFLICT(name) DO NOTHING RETURNING id",[name,passwordHash(d.password)]);
            check(result.rowCount,'Name already taken.',409);id=result.rows[0].id;
          }else{
            const row=(await db.query('SELECT id,password FROM users WHERE name=$1 AND NOT guest AND google_subject IS NULL',[name])).rows[0];
            check(row && timingSafeEqual(Buffer.from(passwordHash(d.password,row.password.split(':')[0])),Buffer.from(row.password)),'Incorrect name or password.',401);id=row.id;
          }
        }
        return this.session(db,id,now);
      }
      check(user,'Sign in to continue.',401);
      if(path==='authorize')return {};
      if(path==='logout'){await db.query('DELETE FROM sessions WHERE token=$1',[hash(token)]);return {};}
      if(path==='state' && user.guest){
        const events=await db.query('SELECT id,name,venue,date,genre FROM events WHERE date>$1 ORDER BY date',[now]);
        return {user,now,events:events.rows,claims:[],history:[]};
      }
      if(path==='state')return {user,now,events:(await db.query('SELECT * FROM events WHERE date>$1 ORDER BY date',[now])).rows,
        claims:(await db.query('SELECT c.event,seat,status,expires FROM claims c JOIN reservations r ON r.id=c.reservation')).rows,
        history:(await db.query('SELECT r.*,name,venue,date FROM reservations r JOIN events e ON e.id=r.event WHERE owner=$1 ORDER BY r.id DESC',[user.id])).rows};
      if(path==='admin-accounts'||path==='create-organizer'){
        check(user.role==='admin','Administrator access required.',403);
        if(path==='admin-accounts'){
          return {accounts:(await db.query("SELECT id,name,role FROM users WHERE NOT guest AND name<>'Sample audience' ORDER BY name")).rows};
        }
        check(typeof d.name==='string' && d.name.trim().length>0 && d.name.length<=64,'Enter an organizer name.');
        check(typeof d.password==='string' && d.password.length>=8 && d.password.length<=256,'Use a password of 8 to 256 characters.');
        const result=await db.query("INSERT INTO users(name,password,role) VALUES ($1,$2,'organizer') ON CONFLICT(name) DO NOTHING RETURNING id",[d.name.trim(),passwordHash(d.password)]);
        check(result.rowCount,'Name already taken.',409);
        return result.rows[0];
      }
      if(['events','edit'].includes(path)){
        check(user.role==='organizer','Organizer access required.',403);
        check(typeof d.name==='string'&&typeof d.venue==='string'&&[d.name,d.venue].every(v=>v.trim()&&v.length<=100),'Enter a name and venue.');
        check(Number.isFinite(d.date)&&d.date!>now&&d.date!<253402300799,'Choose a future date.');
        for(const [value,max] of [[d.rows,26],[d.cols,36],[d.minutes,60],[d.maximum,(d.rows??0)*(d.cols??0)]] as const)check(Number.isInteger(value)&&value!>=1&&value!<=max,'Invalid grid or booking limits.');
        const args=[d.name.trim(),d.venue.trim(),d.date,d.rows,d.cols,d.minutes,d.maximum];
        if(path==='events')return (await db.query('INSERT INTO events(name,venue,date,rows,cols,minutes,maximum) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',args)).rows[0];
        check(!(await db.query('SELECT 1 FROM claims WHERE event=$1 AND (ascii(seat)-64>$2 OR substr(seat,2)::int>$3) LIMIT 1',[d.id,d.rows,d.cols])).rowCount,'Grid would remove occupied seats.',409);
        const result=await db.query('UPDATE events SET name=$1,venue=$2,date=$3,rows=$4,cols=$5,minutes=$6,maximum=$7 WHERE id=$8 RETURNING id',[...args,d.id]);
        check(result.rowCount,'Unknown event.',404);return result.rows[0];
      }
      check(!user.guest,'Sign in to book seats.',401);
      check(user.role==='attendee','Attendee access required.',403);
      if(path==='hold'){
        const e=(await db.query('SELECT * FROM events WHERE id=$1 AND date>$2',[d.event,now])).rows[0];check(e,'Event unavailable.',404);
        const seats=d.seats;
        check(Array.isArray(seats)&&seats.length>0&&seats.length<=e.maximum&&new Set(seats).size===seats.length&&seats.every(s=>typeof s==='string'&&/^[A-Z][1-9][0-9]?$/.test(s)&&s.charCodeAt(0)-64<=e.rows&&Number(s.slice(1))<=e.cols),'Invalid seat selection.');
        check(!(await db.query("SELECT 1 FROM reservations WHERE owner=$1 AND event=$2 AND status='held'",[user.id,e.id])).rowCount,'Finish your existing hold first.',409);
        const r=(await db.query("INSERT INTO reservations(event,owner,status,seats,expires) VALUES($1,$2,'held',$3,$4) RETURNING id",[e.id,user.id,seats,Math.min(e.date,now+60*e.minutes)])).rows[0];
        const claims=await db.query('INSERT INTO claims SELECT $1,s,$2 FROM unnest($3::text[]) s ON CONFLICT DO NOTHING',[e.id,r.id,seats]);
        check(claims.rowCount===seats.length,'Another attendee has taken a selected seat.',409);return r;
      }
      check(['cancel','confirm'].includes(path),'Unknown operation.',404);
      const r=(await db.query('SELECT * FROM reservations WHERE owner=$1 AND id=$2',[user.id,d.id])).rows[0];check(r,'Booking unavailable.',404);
      if(path==='confirm'){
        check(['held','booked'].includes(r.status),'Hold expired or cancelled.',409);await db.query("UPDATE reservations SET status='booked' WHERE id=$1",[r.id]);
      }else{
        check(r.status!=='expired','Hold expired.',409);
        await db.query("UPDATE reservations SET status='cancelled' WHERE id=$1",[r.id]);await db.query('DELETE FROM claims WHERE reservation=$1',[r.id]);
      }return {id:r.id};
    });
  }
}
