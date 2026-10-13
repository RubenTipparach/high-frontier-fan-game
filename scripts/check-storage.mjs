// Storage tools check: the admin Storage report, history clearing and disk
// reclaim, driven over the real routes against a live local server.
//
// Why it matters: clearing history rewrites rows every live game reads. It
// must never touch a game's undo base (the snapshot at committed_seq) or
// anything after it, never touch a recently played game in an "idle" sweep,
// and must leave the mission log's turn labels exactly as they were. This
// plays a real game over the API, seeds a realistic history across every
// status, clears it, and checks all of that, then VACUUMs and plays on.
//
// Needs the server's dependencies (cd server && npm install), so it is NOT in
// CI with the engine checks. Run it before pushing a change to
// server/storage.js or the /admin/storage routes:
//
//   node scripts/check-storage.mjs
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT=fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const require=createRequire(ROOT+'/server/index.js');
const Database=require('better-sqlite3');
const PORT=9620+Math.floor(Math.random()*40), BASE=`http://localhost:${PORT}`;
const DB=join(tmpdir(),`hf-stor-${process.pid}.db`);
const ADMIN_DISCORD_ID='123456789012345678';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const waitFor=async(fn,ms=25000)=>{const t=Date.now();while(Date.now()-t<ms){if(await fn())return true;await sleep(60)}return false};
let pass=0,fail=0; const ok=(c,l)=>{(c?pass++:fail++);console.log(`${c?'PASS':'FAIL'}  ${l}`)};
async function api(m,p,{token,body,cookie}={}){const t0=Date.now();const r=await fetch(BASE+p,{method:m,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});let d=null;try{d=await r.json()}catch{};return{ok:r.ok,status:r.status,data:d,ms:Date.now()-t0}}
const mbf=b=>(b/1048576).toFixed(1)+' MB';
let child; const stop=()=>{try{child&&child.kill('SIGKILL')}catch{} for(const x of ['','-wal','-shm']) try{rmSync(DB+x,{force:true})}catch{}};
const fsize=()=>{let t=0;for(const x of ['','-wal'])try{t+=statSync(DB+x).size}catch{};return t;};
(async()=>{
  child=spawn('node',[ROOT+'/server/index.js'],{env:{...process.env,PORT:String(PORT),DATABASE_PATH:DB,ADMIN_DISCORD_ID},stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',d=>process.stderr.write(d));
  if(!await waitFor(async()=>{try{return (await fetch(BASE+'/lobbies')).ok}catch{return false}})) throw new Error('server down');
  const CREW=(await import(new URL('../data/crew.js', import.meta.url))).CREW;

  // ---- a REAL game, played over the API, for the undo test ----
  const tok=randomBytes(32).toString('base64url');
  await api('POST','/profiles',{body:{name:'St'+randomBytes(3).toString('hex'),token:tok}});
  const me=(await api('GET','/profiles/me',{token:tok})).data.id;
  const lob=(await api('POST','/lobbies',{token:tok,body:{name:'real',maxPlayers:1,maxRounds:7}})).data.lobby;
  const gid=(await api('POST',`/lobbies/${lob.id}/start`,{token:tok})).data.gameId;
  const g0=(await api('GET',`/games/${gid}`,{token:tok})).data.game;
  await api('POST',`/games/${gid}/ops`,{token:tok,body:{kind:'PICK_CREW',cardId:(CREW.find(c=>c.color===g0.state.players[0].color)||CREW[0]).id,face:'primary'}});
  for(let i=0;i<30;i++) await api('POST',`/games/${gid}/ops`,{token:tok,body:{kind:'END_TURN'}});
  await api('POST',`/games/${gid}/ops`,{token:tok,body:{kind:'INCOME'}});   // an undoable action in the CURRENT turn

  // ---- bulk history: realistic volume across every status ----
  const db=new Database(DB);
  const realState=db.prepare('SELECT state FROM game_states WHERE game_id=?').get(gid).state;
  console.log('real state size:', (Buffer.byteLength(realState)/1024).toFixed(1),'KB');
  const plan=[['finished',20],['cancelled',10],['active-idle',10],['active-recent',8]];
  const OPS=450, now=Date.now(), DAY=86400000;
  const mk=db.transaction(()=>{
    let n=0;
    for(const [kind,count] of plan) for(let i=0;i<count;i++){
      const l=db.prepare("INSERT INTO lobbies (code,name,host_id,status,created_at) VALUES (?,?,?,?,?)").run('s'+randomBytes(4).toString('hex'),kind+' '+i,me,kind==='cancelled'?'cancelled':'started',now);
      const status=kind.startsWith('active')?'active':kind;
      const committed = kind==='active-recent' ? OPS-10 : OPS-1;
      const g=db.prepare("INSERT INTO games (lobby_id,seed,status,committed_seq,created_at) VALUES (?,?,?,?,?)").run(l.lastInsertRowid,1,status,committed,now-60*DAY);
      const last = kind==='active-recent' ? now-DAY : now-45*DAY;
      db.prepare("INSERT INTO game_states (game_id,state,seq,updated_at) VALUES (?,?,?,?)").run(g.lastInsertRowid,realState,OPS,last);
      const ins=db.prepare("INSERT INTO game_operations (game_id,seq,profile_id,kind,payload,log,state_after,created_at) VALUES (?,?,?,?,?,?,?,?)");
      for(let s=0;s<OPS;s++){
        // a real board whose round/turn advance, like a real history
        const st=JSON.parse(realState); st.round=1+Math.floor(s/48); st.turn=Math.floor(s/4)%12;
        ins.run(g.lastInsertRowid,s,me,'END_TURN','{}','P ended the turn.',JSON.stringify(st),last-(OPS-s)*1000);
      }
      n++;
    }
    return n;
  });
  const made=mk(); db.close();
  console.log(`seeded ${made} games x ${OPS} ops; database now ${mbf(fsize())}`);

  const adminTok=randomBytes(32).toString('base64url');
  { const d=new Database(DB);
    d.prepare('INSERT INTO admin_sessions (token_hash, discord_id, created_at, expires_at) VALUES (?,?,?,?)')
      .run(createHash('sha256').update(adminTok).digest('hex'),ADMIN_DISCORD_ID,Date.now(),Date.now()+3600e3);
    d.close(); }
  const cookie=`hf_admin=${adminTok}`;

  // ---- 1. the report ----
  // It answers at once and measures the history in the background. While it
  // measures, players must still be served: this is the check that would have
  // caught the 2026-09-23 freeze, where one big query blocked every request.
  const rep0=await api('GET','/admin/storage?top=25&idleDays=30',{cookie});
  ok(rep0.ok && rep0.ms < 500, `the report answers at once (${rep0.ms} ms, scan ${rep0.data.report.scan.status})`);
  let worst=0, polls=0, R=rep0.data.report;
  while (R.scan.status==='running' && polls<600) {
    const t=Date.now(); const pl=await fetch(BASE+'/lobbies'); worst=Math.max(worst, Date.now()-t);
    R=(await api('GET','/admin/storage?top=25&idleDays=30',{cookie})).data.report; polls++;
  }
  ok(R.scan.status==='done', `the background scan finishes (${R.scan.gamesDone}/${R.scan.gamesTotal} games, ${polls} polls)`);
  ok(worst < 300, `players are served throughout the scan (slowest /lobbies ${worst} ms)`);
  const rep={ ok:true, ms: rep0.ms };
  console.log('  byStatus:', JSON.stringify(R.byStatus.map(s=>({s:s.status,g:s.games,hist:mbf(s.snapshotBytes),clear:mbf(s.prunableBytes)}))));
  console.log('  candidates:', JSON.stringify(R.candidates));
  ok(R.candidates.finished===20 && R.candidates.cancelled===10, 'it counts the finished + cancelled games');
  ok(R.candidates.idle===10, `idle = the 10 active games with no move in 30 days, not the 8 recent ones (${R.candidates.idle})`);
  ok(R.topGames.length===25 && R.topGames[0].snapshotBytes>0, 'the biggest games are listed');
  // not an admin -> refused
  ok((await api('GET','/admin/storage')).status===403, 'a non-admin is refused');

  // ---- 2. prune the REAL, in-progress game: undo must survive ----
  const before=(await api('GET',`/games/${gid}/ops`,{token:tok})).data.entries;
  const p1=await api('POST','/admin/storage/prune',{cookie,body:{gameId:gid}});
  ok(p1.ok && p1.data.rows>0, `pruned the live game (${p1.data.rows} snapshots, ${mbf(p1.data.bytesFreed)})`);
  const after=(await api('GET',`/games/${gid}/ops`,{token:tok})).data.entries;
  const same = before.length===after.length && before.every((e,i)=>e.round===after[i].round && e.slot===after[i].slot && e.log===after[i].log);
  ok(same, 'the mission log is unchanged - same entries, same turn labels');
  const undo=await api('POST',`/games/${gid}/ops`,{token:tok,body:{kind:'UNDO'}});
  ok(undo.ok, `UNDO still works on the pruned live game (${JSON.stringify(undo.data&&undo.data.error)})`);
  const old=await api('GET',`/games/${gid}/states/3`,{token:tok});
  ok(old.status===410 && old.data.error==='history_pruned', `an old board answers history_pruned (${old.status})`);
  const p1b=await api('POST','/admin/storage/prune',{cookie,body:{gameId:gid}});
  ok(p1b.ok && p1b.data.rows===0, 'pruning again is a no-op');

  // ---- 3. bulk prune ----
  // A player hammering the server the whole time the clears run.
  let pinging=true, pingWorst=0, pings=0;
  const pinger=(async()=>{ while(pinging){ const t=Date.now(); await fetch(BASE+'/lobbies'); pingWorst=Math.max(pingWorst,Date.now()-t); pings++; } })();
  let total=0, passes=0;
  for(;;){ const r=await api('POST','/admin/storage/prune',{cookie,body:{scope:'finished'}}); passes++;
    ok(r.ok, `bulk finished pass ${passes}: ${r.data.games} games, ${mbf(r.data.bytesFreed)} (${r.ms} ms)`);
    total+=r.data.bytesFreed; if(!r.data.remaining||!r.data.games) break; }
  const recentBefore=(await api('GET','/admin/storage',{cookie})).data.report.byStatus.find(s=>s.status==='active');
  const idleR=await api('POST','/admin/storage/prune',{cookie,body:{scope:'idle',idleDays:30}});
  ok(idleR.ok && idleR.data.games===10, `idle prune took the 10 idle games only (${idleR.data.games})`);
  const cR=await api('POST','/admin/storage/prune',{cookie,body:{scope:'cancelled'}});
  ok(cR.ok && cR.data.games===10, `cancelled prune took all 10 (${cR.data.games})`);
  // the recent active games kept their history
  const d2=new Database(DB,{readonly:true});
  const recentIds=d2.prepare("SELECT g.id FROM games g JOIN lobbies l ON l.id=g.lobby_id WHERE l.name LIKE 'active-recent%'").all().map(r=>r.id);
  const recentPruned=d2.prepare(`SELECT COUNT(*) n FROM game_operations WHERE game_id IN (${recentIds.join(',')}) AND octet_length(state_after) <= 200`).get().n;
  const keptTail=d2.prepare("SELECT COUNT(*) n FROM game_operations o JOIN games g ON g.id=o.game_id WHERE g.status='finished' AND o.seq >= g.committed_seq AND octet_length(o.state_after) > 200").get().n;
  d2.close();
  ok(recentPruned===0, `the recently-played games were not touched (${recentPruned} pruned rows)`);
  ok(keptTail===20, `every finished game kept its undo snapshot (${keptTail}/20)`);
  ok(!(await api('POST','/admin/storage/prune',{cookie,body:{scope:'bogus'}})).ok, 'an unknown scope is refused');
  pinging=false; await pinger;
  ok(pingWorst < 300, `players are served while history is cleared (${pings} requests, slowest ${pingWorst} ms)`);

  // ---- 4. reclaim disk ----
  const sizeBefore=fsize();
  const vac=await api('POST','/admin/storage/vacuum',{cookie});
  const sizeAfter=fsize();
  ok(vac.ok, `VACUUM ran (${vac.data.ms} ms)`);
  ok(sizeAfter < sizeBefore*0.5, `the file shrank: ${mbf(sizeBefore)} -> ${mbf(sizeAfter)}`);
  // the game still plays after the vacuum
  const post=await api('POST',`/games/${gid}/ops`,{token:tok,body:{kind:'INCOME'}});
  ok(post.ok, `the live game still takes moves after the vacuum (${JSON.stringify(post.data&&post.data.error)})`);
  const rep2=(await api('GET','/admin/storage',{cookie})).data.report;
  ok(rep2.pages.reclaimableBytes < 1048576, `nothing left to reclaim (${mbf(rep2.pages.reclaimableBytes)})`);
  console.log(`\n${pass} passed, ${fail} failed`);
  stop(); process.exit(fail?1:0);
})().catch(e=>{console.error(e); stop(); process.exit(1)});
