import 'zone.js';
import '@angular/compiler';
import {Component,provideZoneChangeDetection} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {photoFor,recommend,suggestSeats} from './discovery';
import template from './app.html';

interface Show {id:number;name:string;venue:string;genre:string;date:number;rows:number;cols:number;minutes:number;maximum:number}
interface Booking {id:number;event:number;name:string;venue:string;date:number;seats:string[];status:string;expires:number}
interface State {user:{name:string;role:string;guest:boolean};events:Show[];claims:{event:number;seat:string;status:string;expires:number|null}[];history:Booking[];now:number}
@Component({selector:'stagepass-app',standalone:true,imports:[CommonModule,FormsModule],template})
class App {
  partySize=2;
  zone='Middle';
  suggest(){
    if(!this.event || this.active || this.state?.user.role!=='attendee')return;
    if(this.partySize<1 || this.partySize>this.event.maximum){this.note('Choose a group size within the booking limit.');return;}
    const seats=suggestSeats(this.rows,this.cols,this.seats,this.partySize,this.zone);
    if(seats.length)this.selected=seats;
    this.note(seats.length?'Suggested seats selected. Review them before holding.':'No adjacent seats fit this group. Try fewer seats or select individually.');
  }
  photoFor=photoFor;
  preference='';
  submittedPreference='';
  get recommended(){
    return recommend((this.state?.events ?? []).filter(show=>!this.agendaDate || new Date(show.date*1000).setHours(0,0,0,0)===this.agendaDate),this.submittedPreference);
  }
  agendaDate=0;
  agendaDays:{date:number;events:Show[]}[]=[];
  updateAgenda(events:Show[]){
    const byDay=new Map<number,Show[]>();
    for(const event of events){
      const date=new Date(event.date*1000).setHours(0,0,0,0);
      const group=byDay.get(date);
      if(group)group.push(event);else byDay.set(date,[event]);
    }
    this.agendaDays=Array.from(byDay,([date,events])=>({date,events}));
    if(!byDay.has(this.agendaDate))this.agendaDate=0;
  }
  state?:State;eventId=0;page='events';message='';selected:string[]=[];busy=false;clock=0;offset=0;seq=0;
  name='';password='';register=false;editId=0;form=this.empty();localDate='';timer?:ReturnType<typeof setTimeout>;
  accounts:{id:number;name:string;role:string}[]=[];
  organizerName='';organizerPassword='';
  async loadAccounts(){
    const result=await this.api('admin-accounts',{});
    if(this.state?.user.role==='admin' && this.page==='admin')this.accounts=result.accounts;
  }
  async openAdmin(){
    if(this.state?.user.role!=='admin')return;
    this.page='admin';
    try{await this.loadAccounts();}
    catch(e){this.note(String(e));}
  }
  async createOrganizer(){
    if(await this.act('create-organizer',{name:this.organizerName,password:this.organizerPassword},'Organizer created.')){
      this.organizerName='';this.organizerPassword='';await this.openAdmin();
    }
  }
  empty(){return {name:'',venue:'',rows:10,cols:12,minutes:5,maximum:4};}
  get event(){return this.state?.events.find(e=>e.id===this.eventId);}
  get active(){return this.state?.history.find(r=>r.event===this.eventId&&r.status==='held');}
  get remaining(){const seconds=Math.max(0,Math.ceil((this.active?.expires??0)-this.clock));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
  seats=new Map<string,string>();rows:string[]=[];cols:number[]=[];
  async api(path:string,data?:object){
    const res=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await res.json();if(!res.ok)throw Error(result.message??'Request failed.');return result;
  }
  showAuth(dialog:HTMLDialogElement,register:boolean){
    this.register=register;this.password='';this.message='';dialog.showModal();
  }
  async google(){
    this.busy=true;
    try{const {url}=await this.api('google-start',{});location.assign(url);}
    catch(e){this.note(String(e));}finally{this.busy=false;}
  }
  async ngOnInit(){
    try {
      const params=new URLSearchParams(location.search);
      if(params.has('code')||params.has('error')){
        history.replaceState(null,'',location.pathname);
        if(params.has('code')){
          try{await this.api('google-finish',{code:params.get('code')});}
          catch(e){this.note(String(e));}
        }else this.note('Google sign-in was cancelled or could not be completed.');
      }
      this.applyState(await this.api('open',{}));
      const changes=new EventSource('/api/changes');
      changes.onmessage=()=>this.requestRefresh();
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.requestRefresh();});
      setInterval(()=>{if(changes.readyState!==EventSource.OPEN && !document.hidden)this.requestRefresh();},3000);
      setInterval(()=>this.clock=Date.now()/1000+this.offset,500);
    } catch(e){this.note(String(e));}
  }
  syncing=false;pending=false;
  expiryTimer?:ReturnType<typeof setTimeout>;
  async requestRefresh(){
    this.pending=true;
    if(this.syncing || document.hidden)return;
    this.syncing=true;
    try{
      while(this.pending){
        this.pending=false;
        await this.refresh();
        if(this.page==='admin' && this.state?.user.role==='admin')await this.loadAccounts();
      }
    }catch(e){this.note(String(e));}
    finally{this.syncing=false;}
  }
  async refresh(){
    const seq=++this.seq,s:State=await this.api('state');if(seq!==this.seq)return;
    this.applyState(s);
  }
  applyState(s:State){
    const before=this.state?.events.find(e=>e.id===this.editId);
    const after=s.events.find(e=>e.id===this.editId);
    const updateDraft=this.page==='manage' && before && JSON.stringify(before)!==JSON.stringify(after);
    this.updateAgenda(s.events);
    const priorHold=this.active;
    this.state=s;
    if(priorHold && s.history.some(r=>r.id===priorHold.id && r.status==='expired'))this.note('Your seat hold expired. Choose available seats to try again.');
    if(updateDraft){
      if(!this.dirty){if(!after)this.editId=0;this.edit();}
      else this.note('This event changed while you were editing. Reselect it to load the latest settings.');
    }
    clearTimeout(this.expiryTimer);
    const deadlines=[...s.events.map(e=>e.date),...s.claims.filter(c=>c.status==='held' && c.expires).map(c=>c.expires!)].filter(t=>t>s.now);
    if(deadlines.length){
      const next=deadlines.reduce((a,b)=>Math.min(a,b));
      this.expiryTimer=setTimeout(()=>this.requestRefresh(),Math.min(2147483647,(next-s.now)*1000+50));
    }
    this.offset=s.now-Date.now()/1000;this.clock=s.now;
    if(!this.event)this.eventId=s.events[0]?.id??0;
    this.map();
  }
  map(){
    const e=this.state?.user.guest?undefined:this.event;this.rows=Array.from({length:e?.rows??0},(_,i)=>String.fromCharCode(65+i));this.cols=Array.from({length:e?.cols??0},(_,i)=>i+1);
    this.seats=new Map(this.state?.claims.filter(c=>c.event===this.eventId).map(c=>[c.seat,c.status]));
    this.selected=this.selected.filter(s=>!this.seats.has(s)&&this.rows.includes(s[0])&&this.cols.includes(+s.slice(1))).slice(0,e?.maximum??0);
  }
  pick(id:number){this.eventId=id;this.selected=[];this.map();}
  toggle(s:string){if(this.selected.includes(s))this.selected=this.selected.filter(v=>v!==s);else if(this.selected.length<this.event!.maximum)this.selected=[...this.selected,s];else this.note('Seat limit reached.');}
  note(msg:string){this.message=msg;clearTimeout(this.timer);this.timer=setTimeout(()=>this.message='',5500);}
  async act(path:string,data:object,text:string){
    if(this.busy)return false;this.busy=true;
    try{const r=await this.api(path,data);if(path==='events'||path==='edit'){this.eventId=r.id;this.page='events';}this.selected=[];await this.refresh();this.note(text);return true;}
    catch(e){this.note(String(e));await this.refresh().catch(()=>{});return false;}finally{this.busy=false;}
  }
  async login(dialog:HTMLDialogElement){if(await this.act(this.register?'register':'login',{name:this.name,password:this.password},'Signed in.')){this.password='';dialog.close();if(this.state?.user.role==='admin')await this.openAdmin();}}
  async logout(dialog:HTMLDialogElement){try{await this.api('logout',{});await this.api('guest',{});this.page='events';this.accounts=[];this.organizerPassword='';this.selected=[];await this.refresh();dialog.close();}catch(e){this.note(String(e));}}
  dirty=false;
  edit(){this.dirty=false;const e=this.state?.events.find(v=>v.id===this.editId);this.form=e?{...e}:this.empty();this.localDate=e?new Date((e.date-new Date(e.date*1000).getTimezoneOffset()*60)*1000).toISOString().slice(0,16):'';}
  save(){return this.act(this.editId?'edit':'events',{...this.form,id:this.editId,date:new Date(this.localDate).getTime()/1000},'Event saved.');}
  cancel(r:Booking){if(confirm('Release these seats?'))this.act('cancel',{id:r.id},'Seats released.');}
}
bootstrapApplication(App,{providers:[provideZoneChangeDetection()]});
