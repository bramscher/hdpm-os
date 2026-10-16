import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=await PGlite.create();let count=0;
const ok=(v,m)=>{assert.ok(v,m);count++};const bad=async(fn,re)=>{await assert.rejects(fn,re);count++};
const migration=async name=>db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
try {
 const fixture=await readFile(new URL('./test-maintenance-workspace-db.mjs',import.meta.url),'utf8');
 await db.exec(fixture.match(/await db.exec\(`([\s\S]*?)`\);/)[1]);
 await db.exec("INSERT INTO staff VALUES('Penny','Penny','penny@highdesertpm.com',true,'staff')");
 await migration('20260919_maintenance_workspace.sql');await migration('20261001_parts_orders.sql');
 await migration('20261029_field_time.sql');await migration('20261029_field_time.sql');
 const one=async(sql,params)=>(await db.query(sql,params)).rows[0];
 const call=async(r,actor='office@example.test')=>(await db.query('SELECT field_time_apply($1,$2::jsonb) result',[actor,JSON.stringify(r)])).rows[0].result;
 const admin='office@example.test',alberto='tech@example.test',brody='other@example.test',penny='penny@highdesertpm.com';

 // Seeds: locations and providers, once each, with Lowe's stores under the existing Lowe's provider.
 ok((await one('SELECT count(*)::int n FROM field_place')).n===11,'Seeded 11 stop locations once');
 ok((await one(`SELECT count(*)::int n FROM field_place p JOIN supplier s ON s.id=p.supplier_id WHERE s.name='Lowe''s (Bend Pro desk)'`)).n===2,"Both Lowe's stores belong to the Lowe's provider");
 ok((await one(`SELECT count(*)::int n FROM supplier WHERE name IN ('Parr Lumber','Sherwin-Williams','Miller Paint')`)).n===3,'New providers seeded once');

 const wo=async name=>(await one('INSERT INTO work_orders(property_name) VALUES($1) RETURNING id',[name])).id;
 const wein=await wo('Weinberger 284'),cedar=await wo('Cedar Creek');
 const lowes=(await one(`SELECT id FROM field_place WHERE name='Lowe''s Redmond'`)).id;
 const seg=(kind,from,to,extra={})=>({kind,started_at:`2026-10-07T${from}:00Z`,ended_at:`2026-10-07T${to}:00Z`,property_label:'',allocations:[],candidates:[],...extra});
 const spec={start:'08:00',end:'16:30',stops:[{arrive:'08:00',depart:'16:30',place:{type:'place',id:lowes}}]};
 const daySegments=[seg('on_site','15:00','17:00',{allocations:[{work_order_id:wein,percent:100}]}),seg('parts_run','17:00','17:30',{place_id:lowes}),seg('stop','17:30','18:00')];

 // replace: admin only, version-checked, never over confirmed time.
 const sample={op:'replace',technician:'Alberto',work_date:'2026-10-07',source:'sample',sample_spec:spec,segments:daySegments};
 await bad(()=>call(sample,alberto),/FORBIDDEN/);
 await bad(()=>call({...sample,sample_spec:null}),/needs its stops/);
 await bad(()=>call({...sample,work_date:'2099-01-01'}),/future/);
 let r=await call(sample);ok(r.inserted===3&&r.day.version===2,'Admin builds a sample day');
 const sampleDay=r.day;
 await bad(()=>call({...sample,version:1}),/CONFLICT/);
 await bad(()=>call({...sample,version:2,segments:[seg('on_site','15:00','16:00',{allocations:[{work_order_id:wein,percent:90}]})]}),/add up to 100/);
 r=await call({...sample,version:2});ok(r.day.version===3&&(await one('SELECT count(*)::int n FROM field_segment WHERE day_id=$1',[sampleDay.id])).n===3,'Rebuild replaces suggestions');

 // Sample days are admin-only to confirm; device days belong to their tech.
 const sampleStop=(await one(`SELECT id FROM field_segment WHERE day_id=$1 AND kind='stop'`,[sampleDay.id])).id;
 await bad(()=>call({op:'confirm',segment_id:sampleStop,version:3,label:'personal'},alberto),/FORBIDDEN/);
 r=await call({op:'confirm',segment_id:sampleStop,version:3,label:'personal'});ok(r.segment.state==='confirmed'&&r.day.version===4,'Admin confirms a sample segment');
 ok(r.segment.suggestion.kind==='stop'&&r.segment.suggestion.label===null,'Confirmation keeps what was suggested');
 await bad(()=>call({...sample,version:4,segments:[seg('drive','17:20','17:40')]}),/overlaps confirmed/);
 r=await call({...sample,version:4,segments:daySegments.slice(0,2)});ok(r.day.version===5,'Rebuild keeps confirmed time');
 ok((await one(`SELECT count(*)::int n FROM field_segment WHERE day_id=$1 AND state='confirmed'`,[sampleDay.id])).n===1,'Confirmed segment survives a rebuild');

 const device={op:'replace',technician:'Alberto',work_date:'2026-10-07',source:'device',segments:[...daySegments,seg('no_data','18:00','18:30'),seg('drive','18:30','18:45')]};
 r=await call(device);const deviceDay=r.day;
 const idOf=async kind=>(await one('SELECT id FROM field_segment WHERE day_id=$1 AND kind=$2',[deviceDay.id,kind])).id;
 const onSite=await idOf('on_site'),run=await idOf('parts_run'),stop=await idOf('stop'),gap=await idOf('no_data');
 await bad(()=>call({op:'confirm',segment_id:onSite,version:2,allocations:[{work_order_id:wein,percent:100}]},brody),/FORBIDDEN/);
 await bad(()=>call({op:'confirm',segment_id:onSite,version:2,allocations:[{work_order_id:wein,percent:100}]},penny),/FORBIDDEN/);
 await bad(()=>call({op:'confirm',segment_id:onSite,version:1,allocations:[{work_order_id:wein,percent:100}]},alberto),/CONFLICT/);
 await bad(()=>call({op:'confirm',segment_id:onSite,version:2,allocations:[]},alberto),/Choose the job/);
 await bad(()=>call({op:'confirm',segment_id:onSite,version:2,allocations:[{work_order_id:wein,percent:60},{work_order_id:wein,percent:40}]},alberto),/once in a split/);
 await bad(()=>call({op:'confirm',segment_id:onSite,version:2,allocations:[{work_order_id:'00000000-0000-0000-0000-000000000000',percent:100}]},alberto),/from the list/);
 await bad(()=>call({op:'confirm',segment_id:onSite,version:2,allocations:[{work_order_id:wein,percent:50.5},{work_order_id:cedar,percent:49.5}]},alberto),/whole numbers/);
 await bad(()=>call({op:'confirm',segment_id:onSite,version:2,kind:'parts_run'},alberto),/cannot change/);
 r=await call({op:'confirm',segment_id:onSite,version:2,allocations:[{work_order_id:wein,percent:70},{work_order_id:cedar,percent:30}]},alberto);ok(r.segment.allocations.length===2&&r.day.version===3,'Tech splits a visit across two jobs');
 await bad(()=>call({op:'confirm',segment_id:run,version:3},alberto),/van stock/);
 r=await call({op:'confirm',segment_id:run,version:3,label:'general'},alberto);ok(r.segment.label==='general','A run can be van stock / general');
 await bad(()=>call({op:'confirm',segment_id:stop,version:4},alberto),/Say what this time was/);
 await bad(()=>call({op:'confirm',segment_id:stop,version:4,label:'other_work'},alberto),/Describe the other work/);
 r=await call({op:'confirm',segment_id:stop,version:4,label:'other_work',note:'Helped Brody move a fridge'},alberto);ok(r.segment.note==='Helped Brody move a fridge','Other work needs and keeps a note');
 r=await call({op:'confirm',segment_id:stop,version:5,kind:'inspection',label:''},admin);ok(r.segment.kind==='inspection'&&r.segment.label===null,'A stop can be re-labelled as an inspection');
 r=await call({op:'confirm_all',day_id:deviceDay.id,version:6},alberto);ok(r.confirmed===1,'Confirm all takes only complete suggestions (the drive)');
 ok((await one('SELECT state FROM field_segment WHERE id=$1',[gap])).state==='suggested','A gap still needs the tech');

 // Locations: admin only; geocode failures and duplicate names are clear; deactivating keeps history.
 const place={op:'place_save',kind:'store',name:'Parr Lumber Redmond',address:'443 SW Evergreen Ave, Redmond, OR',latitude:44.27,longitude:-121.18,radius_m:200};
 await bad(()=>call(place,alberto),/FORBIDDEN/);
 await bad(()=>call({...place,latitude:null}),/Paste coordinates/);
 const saved=await call(place);ok(saved.version===1&&saved.kind==='store','Admin adds a location');
 await bad(()=>call({...place,name:"Lowe's Redmond"}),/already exists/);
 await bad(()=>call({...place,id:saved.id,version:7,active:false}),/CONFLICT/);
 const lowesRow=await one('SELECT * FROM field_place WHERE id=$1',[lowes]);
 r=await call({...place,id:lowes,version:lowesRow.version,name:"Lowe's Redmond",active:false});ok(r.active===false,'Admin deactivates a location');
 ok((await one('SELECT count(*)::int n FROM field_segment WHERE place_id=$1',[lowes])).n>0,'Segments still point at a deactivated location');

 // Providers: office staff, version-checked, unique names.
 const provider={op:'supplier_save',name:'Bend Plumbing Supply',phone:'541-555-0100'};
 await bad(()=>call(provider,alberto),/FORBIDDEN/);
 const prov=await call(provider,penny);ok(prov.version===1,'Office adds a provider');
 await bad(()=>call({...provider,id:prov.id,version:1,name:'Ferguson'},penny),/already exists/);
 await bad(()=>call({...provider,id:prov.id,version:3},penny),/CONFLICT/);
 r=await call({...provider,id:prov.id,version:1,name:'Bend Plumbing'},penny);ok(r.name==='Bend Plumbing'&&r.version===2,'Office renames a provider');

 // Deleting a sample day is admin only and removes its segments.
 await bad(()=>call({op:'delete_sample',day_id:sampleDay.id},alberto),/FORBIDDEN/);
 await bad(()=>call({op:'delete_sample',day_id:deviceDay.id}),/Sample day not found/);
 await call({op:'delete_sample',day_id:sampleDay.id});ok((await one('SELECT count(*)::int n FROM field_segment WHERE day_id=$1',[sampleDay.id])).n===0,'Deleting a sample day removes its segments');
 await bad(()=>call({op:'nope'}),/Unknown field time action/);
 ok((await one(`SELECT count(*)::int n FROM maintenance_workspace_audit WHERE op LIKE 'field_time:%'`)).n>=12,'Writes audited');
 ok(!JSON.stringify((await db.query(`SELECT details FROM maintenance_workspace_audit WHERE op='field_time:replace'`)).rows).includes('latitude'),'Day audits carry no coordinates');

 await db.exec('SET ROLE anon');
 await bad(()=>db.query('SELECT * FROM field_segment'),/permission denied/);await bad(()=>db.query('SELECT * FROM field_place'),/permission denied/);
 await bad(()=>call(sample),/permission denied/);
 await db.exec('RESET ROLE');
 console.log(`${count} field time database checks passed`);
} finally {await db.close()}
