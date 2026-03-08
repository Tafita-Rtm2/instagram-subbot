const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');

const PORT    = process.env.PORT || 11000;
const RESULTS = path.join(__dirname, 'results.txt');
const sleep   = ms => new Promise(r => setTimeout(r, ms));
const enc     = o  => new URLSearchParams(o).toString();
const log     = m  => console.log('['+new Date().toLocaleTimeString()+'] '+m);

// ── Noms/usernames ────────────────────────────────────────────────────────────
const FN=['Emma','Lea','Chloe','Jade','Manon','Lucas','Hugo','Tom','Theo','Maxime'];
const LN=['Martin','Dubois','Leroy','Moreau','Simon','Garcia','Roux','Dupont'];
const AD=['cool','happy','swift','bold','free'];
const NO=['sky','star','fire','wave','fox'];
function randName(){ return FN[r(FN.length)]+' '+LN[r(LN.length)]; }
function randUser(){ 
    const n=Math.floor(Math.random()*9999);
    const m=r(3);
    if(m===0) return FN[r(FN.length)].toLowerCase()+'_'+LN[r(LN.length)].toLowerCase()+n;
    if(m===1) return AD[r(AD.length)]+'_'+NO[r(NO.length)]+n;
    return FN[r(FN.length)].toLowerCase()+'.'+n;
}
function r(n){ return Math.floor(Math.random()*n); }

// ── Device helpers ────────────────────────────────────────────────────────────
function rHex(n){ return [...Array(n)].map(()=>r(16).toString(16)).join(''); }
function rUUID(){ return rHex(8)+'-'+rHex(4)+'-4'+rHex(3)+'-'+rHex(4)+'-'+rHex(12); }
function igUA(){
    const sdk=26+r(7);
    const res=['1080x1920','1080x2340','720x1280'][r(3)];
    return 'Instagram 275.0.0.27.98 Android ('+sdk+'/8.0.0; 420dpi; '+res+'; samsung; SM-G998B; star2qltesq; qcom; fr_FR; 458229258)';
}
function igHeaders(csrf,cookies,did){
    return {
        'User-Agent':igUA(),
        'X-CSRFToken':csrf||'',
        'X-IG-App-ID':'936619743392459',
        'X-IG-Device-ID':did||rUUID(),
        'X-IG-Android-ID':'android-'+rHex(16),
        'X-IG-Connection-Type':'WIFI',
        'X-IG-Capabilities':'3brTvwM=',
        'Accept-Language':'fr-FR',
        'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie':cookies||'',
        'Connection':'keep-alive',
    };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function mFetch(url, opts){
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(), opts.timeout||20000);
    try{ return await fetch(url,{...opts,signal:ctrl.signal}); }
    finally{ clearTimeout(t); }
}

async function igPost(url, body, csrf, cookies, did){
    const full = url.startsWith('http')?url:'https://i.instagram.com'+url;
    const resp = await mFetch(full,{
        method:'POST', body,
        headers:igHeaders(csrf,cookies,did),
        redirect:'follow', timeout:25000,
    });
    const sc = resp.headers.raw()['set-cookie']||[];
    const data = await resp.json().catch(()=>({}));
    data._c={};
    for(const c of sc){ const m=c.match(/^([^=]+)=([^;]*)/); if(m) data._c[m[1].trim()]=m[2].trim(); }
    return data;
}

function mergeCk(base, nc){
    const e={};
    for(const p of (base||'').split(';')){ const i=p.indexOf('='); if(i>0) e[p.slice(0,i).trim()]=p.slice(i+1).trim(); }
    Object.assign(e, nc||{});
    return Object.entries(e).map(([k,v])=>k+'='+v).join('; ');
}

// ── Email temp ────────────────────────────────────────────────────────────────
async function getEmail(){
    // Essai 1: guerrillamail
    try{
        const r=await mFetch('https://api.guerrillamail.com/ajax.php?f=get_email_address',{timeout:10000});
        const d=await r.json();
        if(d.email_addr) return {email:d.email_addr,token:d.sid_token,svc:'guerrilla'};
    }catch(e){}
    // Essai 2: mailto.plus random
    const rand=rHex(10);
    return {email:rand+'@mailto.plus',token:rand,svc:'mailto'};
}

async function getCode(token, svc){
    try{
        if(svc==='guerrilla'){
            const r=await mFetch('https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token='+token,{timeout:10000});
            const d=await r.json();
            for(const m of (d.list||[])){
                const mr=await mFetch('https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id='+m.mail_id+'&sid_token='+token,{timeout:10000});
                const md=await mr.json();
                const x=(md.mail_body||'').match(/\b(\d{6})\b/);
                if(x) return x[1];
            }
        }
    }catch(e){}
    return null;
}

// ── TOTP 2FA ──────────────────────────────────────────────────────────────────
function totp(secret){
    try{
        const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const s=secret.replace(/\s/g,'').toUpperCase();
        let bits='';
        for(const c of s){ const i=B32.indexOf(c); if(i>=0) bits+=i.toString(2).padStart(5,'0'); }
        const bytes=[];
        for(let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2));
        const crypto=require('crypto');
        const key=Buffer.from(bytes);
        const T=Math.floor(Date.now()/1000/30);
        const tb=Buffer.alloc(8);
        tb.writeUInt32BE(Math.floor(T/0x100000000),0);
        tb.writeUInt32BE(T>>>0,4);
        const h=crypto.createHmac('sha1',key).update(tb).digest();
        const off=h[19]&0xf;
        const code=(((h[off]&0x7f)<<24)|((h[off+1]&0xff)<<16)|((h[off+2]&0xff)<<8)|(h[off+3]&0xff))%1000000;
        return code.toString().padStart(6,'0');
    }catch(e){ return '000000'; }
}

// ── SESSIONS ──────────────────────────────────────────────────────────────────
const SESSIONS={};

// ── EXPRESS ───────────────────────────────────────────────────────────────────
const app=express();
app.use(express.json());

// POST /api/start
app.post('/api/start',(req,res)=>{
    try{
        const raw=(req.body&&req.body.accounts)||'';
        const accounts=raw.split('\n')
            .map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'))
            .map(l=>{ const p=l.split('|'); return {user:p[0]?.trim(),pass:p[1]?.trim(),tfa:p[2]?.trim()||''}; })
            .filter(a=>a.user&&a.pass);

        if(!accounts.length){
            return res.json({error:'Aucun compte valide ! Format: username|password'});
        }

        const sid='s'+Date.now();
        SESSIONS[sid]={
            running:true, logs:[], phones:[], 
            total:accounts.length*10, done:0,
        };

        res.json({sid});
        log('Session '+sid+' — '+accounts.length+' compte(s)');

        // Lancer en async
        runSession(sid, accounts).catch(e=>{ 
            log('Erreur session: '+e.message);
            if(SESSIONS[sid]) SESSIONS[sid].running=false;
        });

    }catch(e){
        log('Erreur /api/start: '+e.message);
        res.status(500).json({error:e.message});
    }
});

// GET /api/session/:sid
app.get('/api/session/:sid',(req,res)=>{
    const s=SESSIONS[req.params.sid];
    if(!s) return res.json({error:'not found'});
    res.json(s);
});

// POST /api/stop
app.post('/api/stop',(req,res)=>{
    const s=SESSIONS[req.body&&req.body.sid];
    if(s) s.running=false;
    res.json({ok:true});
});

// GET /api/results
app.get('/api/results',(req,res)=>{
    if(!fs.existsSync(RESULTS)) return res.send('Aucun résultat.');
    res.download(RESULTS);
});

// ── LOGIQUE PRINCIPALE ────────────────────────────────────────────────────────
async function runSession(sid, accounts){
    const S=SESSIONS[sid];
    const addLog=(msg,phone)=>{
        S.logs.push(msg);
        log('['+sid+'] '+msg);
        if(phone!=null && S.phones[phone]){
            S.phones[phone].logs.push(msg);
            S.phones[phone].step=msg;
        }
    };

    addLog('🚀 Démarrage — '+accounts.length+' compte(s) — 10 sous-comptes chacun');

    for(let ai=0;ai<accounts.length;ai++){
        if(!S.running) break;
        const acc=accounts[ai];
        addLog('👤 Compte principal : @'+acc.user);

        // Init phone slot pour ce compte principal
        const phoneIdx=S.phones.length;
        S.phones.push({
            id:phoneIdx, mainUser:acc.user,
            step:'Connexion...', logs:[], subs:[], 
            state:'connecting',
        });

        // LOGIN
        addLog('🔐 Connexion à @'+acc.user+'...', phoneIdx);
        const session=await loginAccount(acc, (m)=>addLog(m,phoneIdx));
        
        if(!session){
            addLog('❌ Connexion impossible à @'+acc.user, phoneIdx);
            S.phones[phoneIdx].state='error';
            continue;
        }

        S.phones[phoneIdx].state='active';
        addLog('✅ Connecté à @'+acc.user+' !', phoneIdx);

        // Créer 10 sous-comptes
        for(let i=1;i<=10;i++){
            if(!S.running) break;
            addLog('📱 Sous-compte '+i+'/10...', phoneIdx);
            S.phones[phoneIdx].step='Création sous-compte '+i+'/10';
            
            const sub=await createSub(session, acc.user, i, (m)=>addLog(m,phoneIdx));
            
            if(sub){
                S.phones[phoneIdx].subs.push(sub);
                S.done++;
                addLog('✅ @'+sub.user+' créé !', phoneIdx);
                fs.appendFileSync(RESULTS, acc.user+'|'+sub.user+'|'+sub.pass+'|'+sub.email+'\n');
            } else {
                addLog('⚠️ Sous-compte '+i+' échoué', phoneIdx);
            }

            if(i<10) await sleep(8000+Math.random()*4000);
        }

        S.phones[phoneIdx].step='Terminé — '+S.phones[phoneIdx].subs.length+' sous-comptes';
        S.phones[phoneIdx].state='done';
        addLog('✅ @'+acc.user+' terminé : '+S.phones[phoneIdx].subs.length+'/10 sous-comptes', phoneIdx);

        if(ai<accounts.length-1){ addLog('⏳ Pause 15s...'); await sleep(15000); }
    }

    S.running=false;
    addLog('🏁 Terminé ! '+S.done+' sous-comptes créés.');
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
async function loginAccount(acc, addLog){
    const did=rUUID(), guid=rUUID();
    let csrf='', ck='';

    try{
        const init=await mFetch('https://i.instagram.com/api/v1/si/fetch_headers/?challenge_type=login&guid='+guid,{
            headers:igHeaders('','',did), timeout:15000,
        });
        for(const c of (init.headers.raw()['set-cookie']||[])){
            const m=c.match(/^([^=]+)=([^;]*)/);
            if(m){ ck+=(ck?'; ':'')+m[1].trim()+'='+m[2].trim(); if(m[1].trim()==='csrftoken') csrf=m[2].trim(); }
        }
        if(!csrf) csrf=rHex(8);
    }catch(e){ addLog('⚠️ Init: '+e.message); return null; }

    // Essai login
    const d=await igPost('/api/v1/accounts/login/',enc({
        username:acc.user,
        enc_password:'#PWD_INSTAGRAM:4:'+Math.floor(Date.now()/1000)+':'+acc.pass,
        device_id:did, guid, phone_id:rUUID(), login_attempt_count:'0',
    }),csrf,ck,did);
    ck=mergeCk(ck,d._c); if(d._c.csrftoken) csrf=d._c.csrftoken;

    addLog('📦 Login: '+JSON.stringify(d).substring(0,100));

    // Checkpoint
    if(d.checkpoint_url||d.message==='checkpoint_required'){
        addLog('⚠️ Checkpoint requis sur ce compte — essayez de vous connecter manuellement d\'abord');
        return null;
    }

    // 2FA
    if(d.two_factor_required||d.two_factor_info){
        if(!acc.tfa){ addLog('❌ 2FA requis mais pas de clé dans accounts.txt'); return null; }
        addLog('🔑 2FA: '+totp(acc.tfa));
        const tf=await igPost('/api/v1/accounts/two_factor_login/',enc({
            username:acc.user,
            verificationCode:totp(acc.tfa),
            two_factor_identifier:(d.two_factor_info||{}).two_factor_identifier||'',
            verification_method:'3', device_id:did, guid,
        }),csrf,ck,did);
        ck=mergeCk(ck,tf._c); if(tf._c.csrftoken) csrf=tf._c.csrftoken;
        if(!tf.logged_in_user&&!tf.user){ addLog('❌ 2FA échoué: '+JSON.stringify(tf).substring(0,80)); return null; }
        addLog('✅ 2FA OK');
    } else if(d.user||d.logged_in_user){
        addLog('✅ Login OK');
    } else {
        addLog('❌ Login échoué: '+JSON.stringify(d).substring(0,100));
        return null;
    }

    return {csrf, ck, did, guid};
}

// ── CRÉER SOUS-COMPTE ─────────────────────────────────────────────────────────
async function createSub(session, mainUser, idx, addLog){
    let {csrf,ck,did}=session;
    const merge=(d)=>{ ck=mergeCk(ck,d._c); if(d._c&&d._c.csrftoken) csrf=d._c.csrftoken; };

    const newDid=rUUID(), guid=rUUID(), phoneId=rUUID(), wf=rUUID();
    const uName=randUser(), fullName=randName();
    const pass='Azerty12345!';
    const y=1990+r(20), mo=1+r(12), d=1+r(28);

    // Email temp
    const mail=await getEmail();
    addLog('  📧 '+mail.email+' | @'+uName);

    // Étape 1: send_verify_email
    const v=await igPost('/api/v1/accounts/send_verify_email/',enc({
        phone_id:phoneId, device_id:newDid, email:mail.email, guid, waterfall_id:wf,
    }),csrf,ck,newDid);
    merge(v);
    if(!v.email_sent){ addLog('  ❌ Email non envoyé: '+JSON.stringify(v).substring(0,80)); return null; }
    addLog('  📨 Email envoyé, attente code...');

    // Étape 2: attendre code
    let code=null;
    for(let t=0;t<20&&!code;t++){
        await sleep(6000);
        code=await getCode(mail.token, mail.svc);
        addLog('  ⏳ Code essai '+(t+1)+(code?' → '+code:'...'));
    }
    if(!code){ addLog('  ❌ Code non reçu'); return null; }

    // Étape 3: vérifier code
    const chk=await igPost('/api/v1/accounts/check_confirmation_code/',enc({
        code, device_id:newDid, email:mail.email, guid,
    }),csrf,ck,newDid);
    merge(chk);
    if(!chk.signup_code){ addLog('  ❌ Code invalide: '+JSON.stringify(chk).substring(0,80)); return null; }

    // Étape 4: créer compte
    addLog('  🔨 Création @'+uName+'...');
    const cr=await igPost('/api/v1/accounts/create/',enc({
        is_secondary_account_creation:'1',
        jazoest:'22397',
        phone_id:phoneId,
        enc_password:'#PWD_INSTAGRAM:4:'+Math.floor(Date.now()/1000)+':'+pass,
        username:uName, first_name:fullName,
        day:String(d), month:String(mo), year:String(y),
        seamless_login_enabled:'1',
        email:mail.email,
        reg_flow_taken:'email',
        tos_accepted:'1',
        force_sign_up_code:chk.signup_code,
        waterfall_id:wf, guid, device_id:newDid,
    }),csrf,ck,newDid);
    merge(cr);

    addLog('  📦 Réponse: '+JSON.stringify(cr).substring(0,120));

    if(!(cr.account_created||cr.created_user||( cr.user&&cr.user.pk))){
        addLog('  ❌ Création échouée'); return null;
    }

    return {user:uName, pass, email:mail.email, fullName, mainUser, createdAt:new Date().toISOString()};
}

// ── UI ────────────────────────────────────────────────────────────────────────
app.get('/',(req,res)=>res.send(`<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SubBot</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#08080f;color:#eef0f5;min-height:100vh}
.top{position:sticky;top:0;z-index:9;background:rgba(8,8,15,.95);border-bottom:1px solid #1c1c2a;display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:50px}
.logo{font-weight:800;background:linear-gradient(135deg,#e1306c,#f77737);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
#badge{padding:3px 12px;border-radius:20px;font-size:.72rem;font-weight:700;background:rgba(225,48,108,.12);color:#e1306c}
.layout{display:grid;grid-template-columns:260px 1fr;min-height:calc(100vh - 50px)}
.side{background:#10101a;border-right:1px solid #1c1c2a;padding:16px;display:flex;flex-direction:column;gap:12px}
.main{padding:20px;overflow-y:auto}
.card{background:#10101a;border:1px solid #1c1c2a;border-radius:12px;padding:14px}
.lbl{font-size:.6rem;text-transform:uppercase;letter-spacing:2px;color:#4a4a6a;margin-bottom:8px;font-weight:700}
textarea{width:100%;height:110px;background:#08080f;border:1px solid #1c1c2a;border-radius:8px;color:#eef0f5;font-family:monospace;font-size:.75rem;padding:10px;resize:vertical;outline:none}
textarea:focus{border-color:#e1306c}
.btn{width:100%;padding:11px;border:none;border-radius:10px;font-size:.85rem;font-weight:800;cursor:pointer;transition:.15s}
.go{background:linear-gradient(135deg,#e1306c,#f77737);color:#fff;box-shadow:0 4px 20px rgba(225,48,108,.3)}
.go:hover:not(:disabled){transform:translateY(-1px)}
.go:disabled{opacity:.4;cursor:not-allowed;transform:none}
.stp{background:rgba(225,48,108,.1);color:#e1306c;border:1px solid rgba(225,48,108,.3)}
.dl{background:rgba(59,130,246,.1);color:#3b82f6;border:1px solid rgba(59,130,246,.3)}
.prog{height:4px;background:#1c1c2a;border-radius:2px;overflow:hidden;margin:8px 0}
.pfill{height:100%;background:linear-gradient(90deg,#e1306c,#f77737);width:0;transition:width .5s}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
.stat{background:#08080f;border:1px solid #1c1c2a;border-radius:8px;padding:8px;text-align:center}
.sn{font-size:1.1rem;font-weight:800;font-family:monospace}
.sg{color:#00d68f}.sr{color:#f87171}.sy{color:#f59e0b}
.logbox{height:160px;overflow-y:auto;font-family:monospace;font-size:.62rem;padding:8px;background:#08080f;border-radius:8px}
.ll{padding:2px 0;line-height:1.5;word-break:break-all;color:#555}
.lok{color:#00d68f}.ler{color:#f87171}.lwa{color:#f59e0b}.lin{color:#3b82f6}

/* PHONES GRID */
.phones{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.phone{width:155px;flex-shrink:0;animation:pop .4s cubic-bezier(.175,.885,.32,1.275) both}
@keyframes pop{from{opacity:0;transform:scale(.8) translateY(20px)}to{opacity:1;transform:scale(1)}}
.pframe{width:155px;height:280px;background:#1a1a24;border-radius:22px;border:2px solid #1c1c2a;position:relative;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.5)}
.pframe.act{border-color:#065f46;box-shadow:0 8px 32px rgba(0,214,143,.15)}
.pframe.err{border-color:#7f1d1d;box-shadow:0 8px 32px rgba(248,113,113,.1)}
.pframe.done{border-color:#1e3a5f;box-shadow:0 8px 32px rgba(59,130,246,.15)}
.pframe.conn{border-color:#78350f;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{box-shadow:0 8px 32px rgba(245,158,11,.2)}50%{box-shadow:0 8px 40px rgba(245,158,11,.4)}}
.notch{position:absolute;top:0;left:50%;transform:translateX(-50%);width:46px;height:13px;background:#08080f;border-radius:0 0 10px 10px;z-index:2}
.pstat{display:flex;justify-content:space-between;padding:15px 10px 3px;font-size:.48rem;color:rgba(255,255,255,.3)}
.pscreen{padding:3px 8px 8px;height:calc(280px - 46px);overflow:hidden;display:flex;flex-direction:column;gap:4px}
.igt{display:flex;align-items:center;justify-content:space-between;padding:3px 0}
.igl{font-size:.72rem;font-weight:800;background:linear-gradient(135deg,#e1306c,#f77737);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.igi{width:13px;height:13px;border-radius:3px;background:rgba(255,255,255,.1)}
.av{width:34px;height:34px;border-radius:50%;margin:0 auto;background:linear-gradient(135deg,#e1306c,#f77737);display:flex;align-items:center;justify-content:center;font-size:.8rem;border:2px solid rgba(255,255,255,.1)}
.pun{font-size:.7rem;font-weight:800;text-align:center;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.psi{font-size:.55rem;color:rgba(255,255,255,.35);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pstep{font-size:.55rem;color:rgba(255,255,255,.4);text-align:center;padding:3px 4px;background:rgba(0,0,0,.3);border-radius:5px;min-height:18px;word-break:break-all;line-height:1.3}
.pfield{background:rgba(0,0,0,.3);border-radius:5px;padding:3px 6px;display:flex;justify-content:space-between;align-items:center}
.pfl{font-size:.5rem;color:rgba(255,255,255,.3)}
.pfv{font-size:.52rem;color:rgba(255,255,255,.7);font-weight:600;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pbadges{display:flex;flex-wrap:wrap;gap:2px;justify-content:center;margin-top:2px}
.pb{padding:1px 5px;border-radius:20px;font-size:.48rem;font-weight:700}
.pb-g{background:#064e3b;color:#34d399}.pb-b{background:#0c1a3a;color:#60a5fa}
.sk{background:linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.08) 50%,rgba(255,255,255,.04) 75%);background-size:200% 100%;animation:shim 1.5s infinite;border-radius:4px}
@keyframes shim{0%{background-position:200%}100%{background-position:-200%}}
.spin{width:18px;height:18px;border:2px solid rgba(59,130,246,.2);border-top-color:#3b82f6;border-radius:50%;animation:sp .8s linear infinite;margin:4px auto}
@keyframes sp{to{transform:rotate(360deg)}}
.empty{text-align:center;padding:60px 20px;color:#4a4a6a}
@media(max-width:700px){.layout{grid-template-columns:1fr}.side{border-right:none;border-bottom:1px solid #1c1c2a}}
</style></head><body>

<div class="top">
  <div class="logo">&#x1F916; SubBot Instagram</div>
  <div id="badge">⏹ Arrete</div>
</div>

<div class="layout">
<div class="side">
  <div class="card">
    <div class="lbl">Comptes principaux</div>
    <textarea id="accs" placeholder="username|password&#10;username|password|2FA_KEY&#10;..."></textarea>
    <div style="font-size:.65rem;color:#4a4a6a;margin-top:6px">Format : username|password<br>Avec 2FA : username|password|CLE</div>
    <div id="cnt" style="font-size:.7rem;color:#4a4a6a;margin-top:4px"></div>
  </div>

  <button class="btn go" id="btnGo">&#x1F680; Lancer</button>
  <button class="btn stp" id="btnStp" style="display:none">&#x23F9; Arreter</button>
  <button class="btn dl" onclick="window.open('/api/results','_blank')">&#x2B07; results.txt</button>

  <div class="card" id="progCard" style="display:none">
    <div class="lbl">Progression</div>
    <div class="prog"><div class="pfill" id="pf"></div></div>
    <div id="ptxt" style="font-size:.7rem;color:#4a4a6a;text-align:center;margin-bottom:8px"></div>
    <div class="stats">
      <div class="stat"><div class="sn sg" id="cOk">0</div><div style="font-size:.6rem;color:#4a4a6a">Crees</div></div>
      <div class="stat"><div class="sn sy" id="cTot">0</div><div style="font-size:.6rem;color:#4a4a6a">Cible</div></div>
    </div>
  </div>

  <div class="card">
    <div class="lbl">Logs</div>
    <div class="logbox" id="logbox"></div>
  </div>
</div>

<div class="main">
  <div style="font-size:.7rem;color:#4a4a6a;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px" id="mtitle">Ecrans en direct</div>
  <div class="phones" id="phones"><div class="empty">&#x1F4F1; Lance le bot — chaque compte apparait comme un telephone</div></div>
</div>
</div>

<script>
var SID=null,timer=null,lastLog=0,phones={};

document.getElementById('accs').addEventListener('input',function(){
  var n=this.value.split('\\n').filter(function(l){return l.trim()&&!l.startsWith('#');}).length;
  document.getElementById('cnt').textContent=n?' '+n+' compte(s) detecte(s)':'';
});

document.getElementById('btnGo').addEventListener('click',startBot);
document.getElementById('btnStp').addEventListener('click',stopBot);

function addLog(msg){
  var b=document.getElementById('logbox');
  var d=document.createElement('div');
  var cls='ll';
  if(/OK|cree|succes/i.test(msg)) cls+=' lok';
  else if(/erreur|echoue|impossible/i.test(msg)) cls+=' ler';
  else if(/pause|attente/i.test(msg)) cls+=' lwa';
  else if(/login|connexion|etape|envoi/i.test(msg)) cls+=' lin';
  d.className=cls;
  d.textContent=new Date().toLocaleTimeString()+' '+msg;
  b.insertBefore(d,b.firstChild);
  if(b.children.length>200) b.removeChild(b.lastChild);
}

function renderPhone(p){
  var grid=document.getElementById('phones');
  var el=document.getElementById('ph'+p.id);
  if(!el){
    el=document.createElement('div');
    el.className='phone';
    el.id='ph'+p.id;
    // Remove empty state
    var emp=grid.querySelector('.empty');
    if(emp) emp.remove();
    grid.appendChild(el);
  }

  var stateClass=p.state==='active'?'act':p.state==='error'?'err':p.state==='done'?'done':'conn';
  var lastSub=p.subs&&p.subs.length?p.subs[p.subs.length-1]:null;
  var inner='';

  if(p.state==='connecting'||!lastSub){
    inner='<div class="spin"></div>'
      +'<div class="sk" style="height:9px;width:65%;margin:6px auto"></div>'
      +'<div class="sk" style="height:7px;width:45%;margin:3px auto 8px"></div>'
      +'<div class="sk" style="height:22px;margin-bottom:3px"></div>'
      +'<div class="sk" style="height:22px;margin-bottom:3px"></div>'
      +'<div class="pstep">'+p.step+'</div>';
  } else {
    inner='<div class="igt"><div class="igl">Instagram</div><div style="display:flex;gap:4px"><div class="igi"></div><div class="igi"></div></div></div>'
      +'<div class="av">&#x1F464;</div>'
      +'<div class="pun">@'+lastSub.user+'</div>'
      +'<div class="psi">'+lastSub.fullName+'</div>'
      +'<div class="pfield"><span class="pfl">Email</span><span class="pfv">'+lastSub.email+'</span></div>'
      +'<div class="pfield"><span class="pfl">Pass</span><span class="pfv">'+lastSub.pass+'</span></div>'
      +'<div class="pbadges">'
      +'<span class="pb pb-g">+'+p.subs.length+' sous-comptes</span>'
      +(p.state==='done'?'<span class="pb pb-b">Termine</span>':'')
      +'</div>'
      +'<div class="pstep">'+p.step+'</div>';
  }

  el.innerHTML='<div class="pframe '+stateClass+'">'
    +'<div class="notch"></div>'
    +'<div class="pstat"><span>'+new Date().toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'})+'</span><span>@'+p.mainUser+'</span></div>'
    +'<div class="pscreen">'+inner+'</div>'
    +'</div>'
    +'<div style="text-align:center;font-size:.62rem;color:#4a4a6a;margin-top:5px">@'+p.mainUser+'</div>';
}

async function startBot(){
  var txt=document.getElementById('accs').value.trim();
  if(!txt){alert('Entre au moins un compte !');return;}
  var lines=txt.split('\\n').filter(function(l){return l.trim()&&!l.startsWith('#');});
  if(!lines.length){alert('Aucun compte valide !');return;}

  document.getElementById('btnGo').disabled=true;
  document.getElementById('btnStp').style.display='block';
  document.getElementById('progCard').style.display='block';
  document.getElementById('badge').style.background='rgba(0,214,143,.12)';
  document.getElementById('badge').style.color='#00d68f';
  document.getElementById('badge').textContent='En cours...';
  document.getElementById('phones').innerHTML='';
  lastLog=0; SID=null;
  addLog('Envoi de '+lines.length+' compte(s)...');

  try{
    var r=await fetch('/api/start',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({accounts:txt})
    });
    var data=await r.json();
    if(data.error){addLog('ERREUR: '+data.error);document.getElementById('btnGo').disabled=false;return;}
    SID=data.sid;
    addLog('Session: '+SID);
    timer=setInterval(poll,2000);
  }catch(e){
    addLog('Erreur: '+e.message);
    document.getElementById('btnGo').disabled=false;
  }
}

async function stopBot(){
  if(SID) await fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:SID})}).catch(function(){});
  clearInterval(timer);
  document.getElementById('btnGo').disabled=false;
  document.getElementById('btnStp').style.display='none';
  document.getElementById('badge').style.background='rgba(225,48,108,.12)';
  document.getElementById('badge').style.color='#e1306c';
  document.getElementById('badge').textContent='Arrete';
}

async function poll(){
  if(!SID) return;
  try{
    var d=await fetch('/api/session/'+SID).then(function(r){return r.json();});
    if(d.error){addLog('Session perdue');clearInterval(timer);return;}

    d.logs.slice(lastLog).forEach(function(m){addLog(m);});
    lastLog=d.logs.length;

    var pct=d.total>0?Math.round(d.done/d.total*100):0;
    document.getElementById('pf').style.width=pct+'%';
    document.getElementById('ptxt').textContent=d.done+' / '+d.total+' ('+pct+'%)';
    document.getElementById('cOk').textContent=d.done;
    document.getElementById('cTot').textContent=d.total;
    document.getElementById('mtitle').textContent='Ecrans en direct — '+d.done+' sous-comptes crees';

    (d.phones||[]).forEach(function(p){renderPhone(p);});

    if(!d.running){
      clearInterval(timer);
      document.getElementById('btnGo').disabled=false;
      document.getElementById('btnStp').style.display='none';
      document.getElementById('badge').style.background='rgba(0,214,143,.12)';
      document.getElementById('badge').style.color='#00d68f';
      document.getElementById('badge').textContent='Termine !';
      addLog('Termine ! '+d.done+' sous-comptes crees.');
    }
  }catch(e){}
}
</script></body></html>`));

app.listen(PORT,()=>{
    log('SubBot demarre sur http://localhost:'+PORT);
    if(!fs.existsSync(RESULTS)) fs.writeFileSync(RESULTS,'');
});
