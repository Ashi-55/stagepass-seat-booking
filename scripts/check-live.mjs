import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {localCluster} from './cluster.mjs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const dir='.test-pg-'+randomUUID();
const {pg,url}=await localCluster(dir,Number(process.env.STAGE_TEST_PG_PORT??55439));
process.env.DATABASE_URL=url;
process.env.STAGE_ADMIN_PASSWORD='test-admin-password';process.env.STAGE_ORGANIZER_PASSWORD='test-organizer-password';
const {createApp}=await import('../dist/api/main.js');
const app=await createApp();app.useStaticAssets(process.cwd()+'/dist/web');await app.listen(8137,'127.0.0.1');
const browser=await chromium.launch({channel:'chrome',headless:!process.env.STAGE_SHOW_BROWSER});
try{
 const pages=await Promise.all(Array.from({length:3},async()=>{
   const p=await browser.newPage();
   const listening=p.waitForResponse(r=>r.url().endsWith('/api/changes')&&r.status()===200);
   await p.goto('http://127.0.0.1:8137');await listening;return p;
 }));
 const [attendee,watcher,admin]=pages;
 await admin.click('#account');await admin.getByLabel('Name',{exact:true}).fill('admin');await admin.getByLabel('Password',{exact:true}).fill(process.env.STAGE_ADMIN_PASSWORD);await admin.locator('dialog .primary').click();
 await admin.getByRole('heading',{name:'Accounts'}).waitFor();
 await attendee.getByLabel('Find an event for me').fill('mellow saxophone');
 await attendee.getByRole('button',{name:'Find a match'}).click();
 await attendee.getByRole('button',{name:'Book Blue Hour Sessions',exact:true}).first().waitFor();
 assert.match(await attendee.locator('.discovery [role=status]').innerText(),/Blue Hour Sessions/);
 for(const [page,name] of [[attendee,'Booking attendee'],[watcher,'Live attendee']]){
   await page.locator('.event-card').first().waitFor();
   assert.equal(await page.locator('.stage,.seat,.summary').count(),0);
   await page.getByRole('button',{name:'Sign up',exact:true}).click();
   await page.getByLabel('Name',{exact:true}).fill(name);
   await page.getByLabel('Password',{exact:true}).fill('local-password');
   await page.locator('dialog .primary').click();
   await page.locator('.seat').first().waitFor();
 }
 await attendee.getByRole('button',{name:'Suggest seats'}).click();
 assert.equal(await attendee.locator('.seat.selected').count(),2);

 // Reopen the selected event to clear the temporary suggestion.
 await attendee.reload();await attendee.locator('.seat').first().waitFor();
 const seat=p=>p.locator('.seat').first();
 await seat(attendee).click();await attendee.getByRole('button',{name:'Hold seats'}).click();
 await watcher.waitForSelector('.seat.held',{timeout:2500});
 await attendee.getByRole('button',{name:'Confirm booking'}).click();
 await watcher.waitForFunction(()=>document.querySelector('.seat').classList.contains('booked'),null,{timeout:2500});
 await attendee.getByRole('button',{name:'My bookings'}).click();attendee.once('dialog',d=>d.accept());
 await attendee.getByRole('button',{name:'Cancel booking'}).click();
 await watcher.waitForFunction(()=>!document.querySelector('.seat').disabled,null,{timeout:2500});
 await admin.getByText('Live attendee',{exact:true}).waitFor({timeout:2500});
 assert.equal(await admin.getByRole('button',{name:'Manage events'}).count(),0);
 await admin.click('#account');await admin.getByRole('button',{name:'Sign out'}).click();await admin.locator('dialog').waitFor({state:'hidden'});
 await admin.click('#account');await admin.getByLabel('Name',{exact:true}).fill('organizer');await admin.getByLabel('Password',{exact:true}).fill(process.env.STAGE_ORGANIZER_PASSWORD);await admin.locator('dialog .primary').click();
 await admin.getByRole('button',{name:'Organizer',exact:true}).first().click();await admin.getByLabel('Manage event').selectOption({label:'Midnight Frequencies'});await admin.getByLabel('Maximum seats per booking').fill('2');await admin.getByRole('button',{name:'Save event'}).click();
 await watcher.getByText('0 / 2 selected',{exact:true}).waitFor({timeout:2500});
 console.log('PASS: cross-browser hold, confirmation, cancellation, account creation and event configuration via SSE.');
}finally{
 await browser.close();await app.close();
 // Let idle PostgreSQL pool connections drain before stopping their test server.
 await new Promise(r=>setTimeout(r,11000));await pg.stop();await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
