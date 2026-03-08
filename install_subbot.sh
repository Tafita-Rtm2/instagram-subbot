#!/bin/bash
# ── SubBot Install Script ─────────────────────────────────────────────────────
echo "📦 Installation SubBot..."
rm -rf ~/subbot
mkdir -p ~/subbot
cd ~/subbot

# Écrire subBot.js
cat > subBot.js << 'SUBBOT_EOF'
const express  = require('express');
const fetch    = require('node-fetch');
const fs       = require('fs');
const path     = require('path');
const { generatingName, username } = require('./accountInfoGenerator');

// ── Config ────────────────────────────────────────────────────────────────────
const PASSWORD      = 'Azerty12345!';
const PORT          = process.env.PORT || 11000;
const SUBS_PER_MAIN = 10;
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');
const RESULTS_FILE  = path.join(__dirname, 'results.txt');
const sleep         = ms => new Promise(r => setTimeout(r, ms));
const enc           = obj => new URLSearchParams(obj).toString();
const slog          = msg => console.log('[' + new Date().toLocaleTimeString('fr') + '] ' + msg);

// ── Panel Admin (optionnel) ───────────────────────────────────────────────────
const PANEL_URL   = process.env.PANEL_URL  || '';
const LICENSE_KEY = process.env.LICENSE_KEY || '';

// ── Sessions en cours ─────────────────────────────────────────────────────────
const sessions = {};

// ── Helpers device Android ────────────────────────────────────────────────────
function randHex(n){ return [...Array(n)].map(()=>Math.floor(Math.random()*16).toString(16)).join(''); }
function randUUID(){ return randHex(8)+'-'+randHex(4)+'-4'+randHex(3)+'-'+randHex(4)+'-'+randHex(12); }
function randAndroidId(){ return randHex(16); }

function mobileUA(){
    const v='275.0.0.27.98';
    const res=['1080x1920','1080x2340','1080x2400','720x1280'][Math.floor(Math.random()*4)];
    const sdk=26+Math.floor(Math.random()*7);
    return `Instagram ${v} Android (${sdk}/8.0.0; 420dpi; ${res}; samsung; SM-G998B; star2qltesq; qcom; fr_FR; 458229258)`;
}

function mobileHeaders(csrf, cookieStr, deviceId){
    return {
        'User-Agent'           : mobileUA(),
        'X-CSRFToken'          : csrf||'',
        'X-IG-App-ID'          : '936619743392459',
        'X-IG-Device-ID'       : deviceId||randUUID(),
        'X-IG-Android-ID'      : 'android-'+randAndroidId(),
        'X-IG-Connection-Type' : 'WIFI',
        'X-IG-Capabilities'    : '3brTvwM=',
        'Accept-Language'      : 'fr-FR',
        'Content-Type'         : 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept-Encoding'      : 'gzip, deflate',
        'Cookie'               : cookieStr||'',
        'Connection'           : 'keep-alive',
    };
}

async function makeFetch(url, opts={}){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), opts.timeout||20000);
    try{
        return await fetch(url,{...opts, signal:controller.signal});
    }finally{ clearTimeout(timer); }
}

async function mobilePost(endpoint, params, csrf, cookieStr, deviceId){
    const url = endpoint.startsWith('http')?endpoint:'https://i.instagram.com'+endpoint;
    const resp = await makeFetch(url,{
        method:'POST',
        headers:mobileHeaders(csrf,cookieStr,deviceId),
        body:enc(params),
        redirect:'follow',
        timeout:25000,
    });
    const newCookies = resp.headers.raw()['set-cookie']||[];
    const data = await resp.json().catch(()=>({}));
    data._newCookies={};
    for(const c of newCookies){
        const m=c.match(/^([^=]+)=([^;]*)/);
        if(m) data._newCookies[m[1].trim()]=m[2].trim();
    }
    return data;
}

async function mobileGet(endpoint, csrf, cookieStr, deviceId){
    const url = endpoint.startsWith('http')?endpoint:'https://i.instagram.com'+endpoint;
    const resp = await makeFetch(url,{
        headers:mobileHeaders(csrf,cookieStr,deviceId),
        redirect:'follow',
        timeout:20000,
    });
    const data = await resp.json().catch(()=>({}));
    return data;
}

function mergeCookies(existing, newCookies={}){
    const ex={};
    for(const p of (existing||'').split(';')){
        const i=p.indexOf('='); if(i>0) ex[p.substring(0,i).trim()]=p.substring(i+1).trim();
    }
    Object.assign(ex, newCookies);
    return Object.entries(ex).map(e=>e[0]+'='+e[1]).join('; ');
}

// ── Lire accounts.txt ─────────────────────────────────────────────────────────
function loadMainAccounts(){
    if(!fs.existsSync(ACCOUNTS_FILE)) return [];
    return fs.readFileSync(ACCOUNTS_FILE,'utf-8')
        .split('\n')
        .map(l=>l.trim())
        .filter(l=>l && !l.startsWith('#'))
        .map(l=>{
            const parts = l.split('|');
            return { username: parts[0]?.trim(), password: parts[1]?.trim(), twofa: parts[2]?.trim()||'' };
        })
        .filter(a=>a.username && a.password);
}

// ── Sauvegarder résultat ──────────────────────────────────────────────────────
function saveResult(mainUsername, subAccount){
    const line = mainUsername+'|'+subAccount.uName+'|'+subAccount.password+'|'+subAccount.email+'\n';
    fs.appendFileSync(RESULTS_FILE, line, 'utf-8');
}

// ── Envoyer au panel admin ────────────────────────────────────────────────────
async function sendToPanel(mainAccount, subAccount){
    if(!PANEL_URL) return;
    try{
        await makeFetch(PANEL_URL+'/api/sub-accounts', {
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+LICENSE_KEY},
            body:JSON.stringify({
                mainUser: mainAccount.username,
                subUser: subAccount.uName,
                subPass: subAccount.password,
                subEmail: subAccount.email,
                cookies: subAccount.cookies,
                createdAt: new Date().toISOString(),
            }),
            timeout:10000,
        });
    }catch(e){ slog('⚠️ Panel : '+e.message); }
}

// ── Email temporaire (gleeze.com) ─────────────────────────────────────────────
async function getTempEmail(){
    try{
        const r = await makeFetch('https://api.gleeze.com/api/create',{timeout:10000});
        const d = await r.json();
        if(d.email) return { email:d.email, token:d.token||d.id, service:'gleeze' };
    }catch(e){}
    // fallback guerrilla
    try{
        const r = await makeFetch('https://api.guerrillamail.com/ajax.php?f=get_email_address',{timeout:10000});
        const d = await r.json();
        if(d.email_addr) return { email:d.email_addr, token:d.sid_token, service:'guerrilla' };
    }catch(e){}
    // fallback random
    const rand = randHex(10);
    return { email: rand+'@mailto.plus', token: rand, service:'mailto' };
}

async function getEmailCode(token, service, emailAddr){
    try{
        if(service==='gleeze'){
            const r = await makeFetch('https://api.gleeze.com/api/inbox?token='+token,{timeout:10000});
            const d = await r.json();
            const msgs = d.messages||d.inbox||[];
            for(const m of msgs){
                const body = (m.body||m.content||m.subject||'');
                const match = body.match(/\b(\d{6})\b/);
                if(match) return match[1];
            }
        } else if(service==='guerrilla'){
            const r = await makeFetch('https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token='+token,{timeout:10000});
            const d = await r.json();
            for(const m of (d.list||[])){
                if(m.mail_id){
                    const mr = await makeFetch('https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id='+m.mail_id+'&sid_token='+token,{timeout:10000});
                    const md = await mr.json();
                    const match = (md.mail_body||'').match(/\b(\d{6})\b/);
                    if(match) return match[1];
                }
            }
        }
    }catch(e){}
    return null;
}

// ── LOGIN compte principal ────────────────────────────────────────────────────
async function loginMainAccount(account, log){
    const deviceId  = randUUID();
    const guid      = randUUID();
    let csrf = '', cookieStr = '';

    log('🔐 Login @'+account.username+'…');

    // Init CSRF
    try{
        const init = await makeFetch('https://i.instagram.com/api/v1/si/fetch_headers/?challenge_type=login&guid='+guid,{
            headers: mobileHeaders('','',deviceId),
            timeout: 15000,
        });
        const initCookies = init.headers.raw()['set-cookie']||[];
        for(const c of initCookies){
            const m=c.match(/^([^=]+)=([^;]*)/);
            if(m){
                cookieStr += (cookieStr?'; ':'')+m[1].trim()+'='+m[2].trim();
                if(m[1].trim()==='csrftoken') csrf=m[2].trim();
            }
        }
        if(!csrf) csrf='missing_'+randHex(8);
    }catch(e){ log('⚠️ Init: '+e.message); return null; }

    // Login
    const loginData = await mobilePost('/api/v1/accounts/login/', {
        username         : account.username,
        enc_password     : '#PWD_INSTAGRAM:4:'+Math.floor(Date.now()/1000)+':'+account.password,
        device_id        : deviceId,
        guid             : guid,
        phone_id         : randUUID(),
        login_attempt_count: '0',
        country_codes    : '[{"country_code":"1","source":["default"]}]',
    }, csrf, cookieStr, deviceId);

    cookieStr = mergeCookies(cookieStr, loginData._newCookies);
    if(loginData._newCookies?.csrftoken) csrf=loginData._newCookies.csrftoken;

    // 2FA si demandé
    if(loginData.two_factor_required || loginData.two_factor_info){
        log('🔑 2FA requis…');
        if(!account.twofa){ log('❌ Pas de clé 2FA dans accounts.txt'); return null; }
        const twoFaId = loginData.two_factor_info?.two_factor_identifier;
        const totp = generate2FA(account.twofa);
        const tfData = await mobilePost('/api/v1/accounts/two_factor_login/', {
            username            : account.username,
            verificationCode    : totp,
            two_factor_identifier: twoFaId,
            verification_method : '3',
            device_id           : deviceId,
            guid                : guid,
        }, csrf, cookieStr, deviceId);
        cookieStr = mergeCookies(cookieStr, tfData._newCookies);
        if(tfData._newCookies?.csrftoken) csrf=tfData._newCookies.csrftoken;
        if(!tfData.logged_in_user && !tfData.user){ log('❌ 2FA échoué : '+JSON.stringify(tfData).substring(0,80)); return null; }
        log('✅ 2FA OK !');
    } else if(loginData.user || loginData.logged_in_user){
        log('✅ Login réussi @'+account.username);
    } else {
        log('❌ Login échoué : '+JSON.stringify(loginData).substring(0,100));
        return null;
    }

    return { csrf, cookieStr, deviceId, guid };
}

// ── TOTP 2FA basique ──────────────────────────────────────────────────────────
function generate2FA(secret){
    // Implémentation TOTP basique (RFC 6238)
    try{
        const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const s = secret.replace(/\s/g,'').toUpperCase();
        let bits='';
        for(const c of s){ const i=base32chars.indexOf(c); if(i>=0) bits+=i.toString(2).padStart(5,'0'); }
        const bytes=[];
        for(let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2));
        const buf = Buffer.from(bytes);
        const T = Math.floor(Date.now()/1000/30);
        const tbuf = Buffer.alloc(8);
        tbuf.writeUInt32BE(Math.floor(T/0x100000000),0);
        tbuf.writeUInt32BE(T>>>0,4);
        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha1',buf).update(tbuf).digest();
        const offset = hmac[19]&0xf;
        const code = (((hmac[offset]&0x7f)<<24)|((hmac[offset+1]&0xff)<<16)|((hmac[offset+2]&0xff)<<8)|(hmac[offset+3]&0xff))%1000000;
        return code.toString().padStart(6,'0');
    }catch(e){ return '000000'; }
}

// ── CRÉER UN SOUS-COMPTE ──────────────────────────────────────────────────────
async function createSubAccount(session, mainUsername, log){
    const { csrf, cookieStr: cookieBase, deviceId } = session;
    let cookieStr = cookieBase;
    let currentCsrf = csrf;

    const merge = (data)=>{
        if(data._newCookies){
            cookieStr = mergeCookies(cookieStr, data._newCookies);
            if(data._newCookies.csrftoken) currentCsrf=data._newCookies.csrftoken;
        }
    };

    const guid      = randUUID();
    const phoneId   = randUUID();
    const waterfall = randUUID();
    const newDevId  = randUUID();
    const uName     = username();
    const fullName  = generatingName();
    const randomY   = 1990+Math.floor(Math.random()*20);
    const randomM   = 1+Math.floor(Math.random()*12);
    const randomD   = 1+Math.floor(Math.random()*28);

    // Email temp pour le sous-compte
    const mail = await getTempEmail();
    log('  📧 Sous-compte : '+mail.email+' | @'+uName);

    // ── Étape 1 : send_verify_email ───────────────────────────────────────────
    const ver = await mobilePost('/api/v1/accounts/send_verify_email/',{
        phone_id   : phoneId,
        device_id  : newDevId,
        email      : mail.email,
        guid       : guid,
        waterfall_id: waterfall,
    }, currentCsrf, cookieStr, newDevId);
    merge(ver);

    if(!ver.email_sent){
        log('  ❌ Email non envoyé : '+JSON.stringify(ver).substring(0,80));
        return null;
    }

    // ── Étape 2 : attendre code ───────────────────────────────────────────────
    let code = null;
    for(let t=0;t<24&&!code;t++){
        await sleep(5000);
        code = await getEmailCode(mail.token, mail.service, mail.email);
        log('  📬 Code essai '+(t+1)+(code?' → '+code:'…'));
    }
    if(!code){ log('  ❌ Code non reçu'); return null; }

    // ── Étape 3 : check_confirmation_code ────────────────────────────────────
    const chk = await mobilePost('/api/v1/accounts/check_confirmation_code/',{
        code, device_id: newDevId, email: mail.email, guid,
    }, currentCsrf, cookieStr, newDevId);
    merge(chk);
    if(!chk.signup_code){ log('  ❌ Code invalide : '+JSON.stringify(chk).substring(0,80)); return null; }

    // ── Étape 4 : create sub-account (is_secondary_account_creation=1) ────────
    log('  📡 Création sous-compte…');
    const createData = {
        is_secondary_account_creation : '1',   // ← CLÉ : indique que c'est un sous-compte
        jazoest                       : '22397',
        suggestedUsername             : '',
        do_not_auto_login_on_2fa      : 'false',
        phone_id                      : phoneId,
        enc_password                  : '#PWD_INSTAGRAM:4:'+Math.floor(Date.now()/1000)+':'+PASSWORD,
        username                      : uName,
        first_name                    : fullName,
        day                           : String(randomD),
        month                         : String(randomM),
        year                          : String(randomY),
        seamless_login_enabled        : '1',
        email                         : mail.email,
        reg_flow_taken                : 'email',
        tos_accepted                  : '1',
        force_sign_up_code            : chk.signup_code,
        waterfall_id                  : waterfall,
        guid                          : guid,
        device_id                     : newDevId,
    };

    const created = await mobilePost('/api/v1/accounts/create/', createData, currentCsrf, cookieStr, newDevId);
    merge(created);

    log('  📦 Réponse : '+JSON.stringify(created).substring(0,120));

    if(!(created.account_created || created.created_user || created.user?.pk)){
        log('  ❌ Création échouée : '+JSON.stringify(created).substring(0,100));
        return null;
    }

    const result = {
        uName,
        fullName,
        password : PASSWORD,
        email    : mail.email,
        cookies  : cookieStr,
        csrf     : currentCsrf,
        mainUser : mainUsername,
        createdAt: new Date().toISOString(),
    };

    log('  🎉 Sous-compte @'+uName+' créé !');
    return result;
}

// ── TRAITEMENT D'UN COMPTE PRINCIPAL ─────────────────────────────────────────
async function processMainAccount(account, sessionData, log){
    log('═══════════════════════════════');
    log('👤 Compte principal : @'+account.username);

    // Login
    const session = await loginMainAccount(account, log);
    if(!session){ log('❌ Login impossible, compte ignoré'); return []; }

    const subAccounts = [];
    let failures = 0;

    for(let i=1; i<=SUBS_PER_MAIN; i++){
        log('📱 Sous-compte '+i+'/'+SUBS_PER_MAIN+'…');
        try{
            const sub = await createSubAccount(session, account.username, log);
            if(sub){
                subAccounts.push(sub);
                saveResult(account.username, sub);
                await sendToPanel(account, sub);
                sessionData.subs.push(sub);
                log('✅ ['+i+'/'+SUBS_PER_MAIN+'] @'+sub.uName+' sauvegardé');
                failures = 0;
            } else {
                failures++;
                log('⚠️ Échec sous-compte '+i);
                if(failures >= 3){ log('⛔ 3 échecs consécutifs, passage au compte suivant'); break; }
            }
        }catch(e){
            log('❌ Erreur : '+e.message);
            failures++;
            if(failures >= 3) break;
        }
        // Délai anti-ban entre chaque sous-compte
        if(i < SUBS_PER_MAIN) await sleep(8000 + Math.random()*5000);
    }

    log('✅ @'+account.username+' terminé : '+subAccounts.length+' sous-comptes créés');
    return subAccounts;
}

// ── EXPRESS ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Lancer le bot
app.post('/api/start', async (req, res) => {
    // Accepter comptes depuis le body OU depuis accounts.txt
    if(req.body.accounts){
        try{ fs.writeFileSync(ACCOUNTS_FILE, req.body.accounts, 'utf-8'); }catch(e){}
    }

    const accounts = loadMainAccounts();
    if(!accounts.length){
        return res.json({ error: 'Aucun compte valide ! Format: username|password' });
    }

    const sessionId = Date.now().toString();
    sessions[sessionId] = {
        running : true,
        logs    : [],
        mains   : [],
        subs    : [],
        total   : accounts.length * SUBS_PER_MAIN,
        done    : 0,
    };
    res.json({ sessionId });

    const log = msg => {
        sessions[sessionId].logs.push(msg);
        slog(msg);
    };

    sessions[sessionId].total = accounts.length * SUBS_PER_MAIN;
    sessions[sessionId].mains = accounts.map(a=>({username:a.username,subs:0}));
    log('🚀 Démarrage — '+accounts.length+' compte(s) principal / '+SUBS_PER_MAIN+' sous-comptes chacun');
    log('🎯 Total visé : '+(accounts.length*SUBS_PER_MAIN)+' sous-comptes');

    for(const account of accounts){
        if(!sessions[sessionId].running) break;
        await processMainAccount(account, sessions[sessionId], log);
        sessions[sessionId].done = sessions[sessionId].subs.length;
        if(accounts.indexOf(account) < accounts.length-1){
            log('⏳ Pause 15s entre les comptes principaux…');
            await sleep(15000);
        }
    }

    sessions[sessionId].running = false;
    log('🏁 Terminé ! '+sessions[sessionId].subs.length+' sous-comptes créés au total.');
    log('📁 Résultats sauvegardés dans results.txt');
});

// Arrêter
app.post('/api/stop', (req, res) => {
    const { sessionId } = req.body;
    if(sessions[sessionId]) sessions[sessionId].running = false;
    res.json({ ok: true });
});

// Statut
app.get('/api/session/:id', (req, res) => {
    const s = sessions[req.params.id];
    if(!s) return res.json({ error: 'not found' });
    res.json(s);
});

// Lire accounts.txt
app.get('/api/accounts', (req, res) => {
    const accounts = loadMainAccounts();
    res.json({ count: accounts.length, accounts: accounts.map(a=>({username:a.username, has2fa:!!a.twofa})) });
});

// Uploader accounts.txt via UI
app.post('/api/accounts/upload', express.text(), (req, res) => {
    try{
        fs.writeFileSync(ACCOUNTS_FILE, req.body, 'utf-8');
        const count = loadMainAccounts().length;
        res.json({ ok: true, count });
    }catch(e){ res.json({ ok: false, error: e.message }); }
});

// Télécharger results.txt
app.get('/api/results/download', (req, res) => {
    if(!fs.existsSync(RESULTS_FILE)) return res.send('Aucun résultat encore.');
    res.download(RESULTS_FILE);
});

// ── UI ────────────────────────────────────────────────────────────────────────
const UI = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SubBot — Sous-comptes Instagram</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:ital,wght@0,400;0,700;0,800;1,400&display=swap" rel="stylesheet">
<style>
:root{--bg:#08080f;--s:#10101a;--b:#1c1c2a;--accent:#e1306c;--a2:#f77737;--green:#00d68f;--blue:#3b82f6;--yellow:#f59e0b;--text:#eef0f5;--muted:#4a4a6a;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 50% at 50% -20%,rgba(225,48,108,.08),transparent);pointer-events:none;}

.top{position:sticky;top:0;z-index:99;background:rgba(8,8,15,.9);backdrop-filter:blur(16px);border-bottom:1px solid var(--b);display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:52px;}
.logo{font-family:'Space Mono',monospace;font-weight:700;font-size:.95rem;background:linear-gradient(135deg,var(--accent),var(--a2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.badge{padding:2px 10px;border-radius:20px;font-size:.7rem;font-weight:700;}
.badge-green{background:rgba(0,214,143,.12);color:var(--green);}
.badge-red{background:rgba(225,48,108,.12);color:var(--accent);}

.layout{display:grid;grid-template-columns:280px 1fr;min-height:calc(100vh - 52px);}
.side{background:var(--s);border-right:1px solid var(--b);padding:20px;display:flex;flex-direction:column;gap:16px;}
.main{padding:24px;overflow-y:auto;}

.card{background:var(--s);border:1px solid var(--b);border-radius:14px;padding:16px;}
.label{font-family:'Space Mono',monospace;font-size:.62rem;text-transform:uppercase;letter-spacing:2px;color:var(--muted);margin-bottom:10px;}

/* accounts input */
.accs-area{width:100%;height:140px;background:var(--bg);border:1px solid var(--b);border-radius:10px;color:var(--text);font-family:'Space Mono',monospace;font-size:.7rem;padding:10px;resize:vertical;outline:none;line-height:1.6;}
.accs-area:focus{border-color:var(--accent);}
.accs-hint{font-size:.65rem;color:var(--muted);margin-top:6px;line-height:1.5;}

/* buttons */
.btn{width:100%;padding:12px;border:none;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:.88rem;font-weight:800;cursor:pointer;transition:.2s;}
.btn-start{background:linear-gradient(135deg,var(--accent),var(--a2));color:#fff;box-shadow:0 4px 20px rgba(225,48,108,.3);}
.btn-start:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 28px rgba(225,48,108,.5);}
.btn-start:disabled{opacity:.35;cursor:not-allowed;transform:none;}
.btn-stop{background:rgba(225,48,108,.1);color:var(--accent);border:1px solid rgba(225,48,108,.3);}
.btn-stop:hover{background:rgba(225,48,108,.2);}
.btn-dl{background:rgba(59,130,246,.1);color:var(--blue);border:1px solid rgba(59,130,246,.3);margin-top:8px;}
.btn-dl:hover{background:rgba(59,130,246,.2);}

/* progress */
.prog-track{height:4px;background:var(--b);border-radius:2px;margin:10px 0;overflow:hidden;}
.prog-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--a2));border-radius:2px;transition:width .5s ease;width:0;}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px;}
.stat{background:var(--bg);border:1px solid var(--b);border-radius:8px;padding:8px;text-align:center;}
.stat .n{font-family:'Space Mono',monospace;font-size:1.1rem;font-weight:700;}
.n-g{color:var(--green)}.n-b{color:#f87171}.n-y{color:var(--yellow)}

/* logs */
.logs{height:220px;overflow-y:auto;font-family:'Space Mono',monospace;font-size:.65rem;padding:10px;background:var(--bg);border-radius:8px;}
.logs::-webkit-scrollbar{width:3px;}
.logs::-webkit-scrollbar-thumb{background:var(--b);}
.ll{padding:2px 0;border-bottom:1px solid rgba(255,255,255,.03);line-height:1.5;}
.ok{color:var(--green)}.er{color:#f87171}.wa{color:var(--yellow)}.in{color:var(--blue)}.df{color:#555}

/* table sous-comptes */
.tb{width:100%;border-collapse:collapse;font-size:.78rem;}
.tb th{font-family:'Space Mono',monospace;font-size:.6rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);padding:8px 12px;text-align:left;border-bottom:1px solid var(--b);}
.tb td{padding:8px 12px;border-bottom:1px solid var(--b);color:var(--text);}
.tb tr:hover td{background:rgba(255,255,255,.02);}
.cp{background:transparent;border:1px solid var(--b);color:var(--muted);border-radius:5px;padding:1px 7px;cursor:pointer;font-size:.65rem;}
.cp:hover{color:var(--text);border-color:var(--accent);}
.main-tag{background:rgba(225,48,108,.12);color:var(--accent);padding:1px 8px;border-radius:20px;font-size:.65rem;font-weight:700;}

.empty{text-align:center;padding:60px;color:var(--muted);}
.empty-ico{font-size:2.5rem;margin-bottom:12px;opacity:.4;}

@media(max-width:800px){.layout{grid-template-columns:1fr}.side{border-right:none;border-bottom:1px solid var(--b)}}
</style>
</head>
<body>
<div class="top">
  <div class="logo">&#x1F916; SubBot — Sous-comptes IG</div>
  <div id="status-badge" class="badge badge-red">⏹ Arrêté</div>
</div>

<div class="layout">
<div class="side">

  <div class="card">
    <div class="label">Comptes principaux</div>
    <textarea class="accs-area" id="accs-input" placeholder="username|password&#10;username|password|CLE2FA&#10;username|password&#10;..."></textarea>
    <div class="accs-hint">Format : username|password ou username|password|clé2fa<br>Un compte par ligne — les lignes # sont ignorées</div>
    <div id="accs-count" style="font-size:.7rem;color:var(--muted);margin-top:6px;"></div>
  </div>

  <button class="btn btn-start" id="btn-start" onclick="start()">🚀 Lancer le bot</button>
  <button class="btn btn-stop" id="btn-stop" style="display:none" onclick="stop()">⏹ Arrêter</button>
  <button class="btn btn-dl" onclick="download()">⬇️ Télécharger results.txt</button>

  <div class="card" id="prog-card" style="display:none">
    <div class="label">Progression</div>
    <div class="prog-track"><div class="prog-fill" id="prog-fill"></div></div>
    <div id="prog-txt" style="font-size:.7rem;color:var(--muted);text-align:center;"></div>
    <div class="stats">
      <div class="stat"><div class="n n-g" id="cnt-ok">0</div><div style="font-size:.6rem;color:var(--muted);margin-top:2px">✅ Créés</div></div>
      <div class="stat"><div class="n n-y" id="cnt-main">0</div><div style="font-size:.6rem;color:var(--muted);margin-top:2px">👤 Mains</div></div>
      <div class="stat"><div class="n n-b" id="cnt-target">0</div><div style="font-size:.6rem;color:var(--muted);margin-top:2px">🎯 Cible</div></div>
    </div>
  </div>

  <div class="card">
    <div class="label">Logs</div>
    <div class="logs" id="logs"></div>
  </div>

</div>

<div class="main">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
    <div style="font-family:'Space Mono',monospace;font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:2px;" id="table-title">📋 Sous-comptes créés</div>
    <div id="sub-count" style="font-size:.78rem;color:var(--muted);"></div>
  </div>
  <div id="table-wrap">
    <div class="empty"><div class="empty-ico">📱</div><p>Lance le bot — les sous-comptes s'affichent ici en temps réel</p></div>
  </div>
</div>
</div>

<script>
var sessionId=null, pollTimer=null, lastLog=0, allSubs=[];

document.getElementById('accs-input').addEventListener('input', function(){
  var lines=this.value.split('\\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
  document.getElementById('accs-count').textContent=lines.length+' compte(s) détecté(s)';
});

function addLog(msg){
  var box=document.getElementById('logs');
  var cls='df';
  if(msg.includes('✅')||msg.includes('🎉')) cls='ok';
  else if(msg.includes('❌')) cls='er';
  else if(msg.includes('⚠️')) cls='wa';
  else if(msg.includes('🚀')||msg.includes('📡')||msg.includes('📬')) cls='in';
  var d=document.createElement('div');
  d.className='ll '+cls;
  d.textContent=new Date().toLocaleTimeString('fr')+' '+msg;
  box.insertBefore(d,box.firstChild);
  while(box.children.length>300) box.removeChild(box.lastChild);
}

function cp(t){ if(navigator.clipboard){navigator.clipboard.writeText(t);}else{var x=document.createElement('textarea');x.value=t;document.body.appendChild(x);x.select();document.execCommand('copy');document.body.removeChild(x);} }

function renderTable(){
  var wrap=document.getElementById('table-wrap');
  if(!allSubs.length){
    wrap.innerHTML='<div class="empty"><div class="empty-ico">📱</div><p>Aucun sous-compte encore créé</p></div>';
    return;
  }
  var rows=allSubs.slice().reverse().map(s=>
    '<tr>'
    +'<td><span class="main-tag">'+s.mainUser+'</span></td>'
    +'<td>@'+s.uName+'</td>'
    +'<td>'+s.email+'</td>'
    +'<td>'+s.password+'</td>'
    +'<td>'+new Date(s.createdAt).toLocaleTimeString('fr')+'</td>'
    +'<td>'
      +'<button class="cp" onclick="cp(\''+s.uName+'|'+s.password+'|'+s.email+'\')">⎘ Copier</button>'
    +'</td>'
    +'</tr>'
  ).join('');
  wrap.innerHTML='<table class="tb"><thead><tr><th>Compte principal</th><th>Sous-compte</th><th>Email</th><th>Mot de passe</th><th>Créé à</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
}

async function start(){
  var txt=document.getElementById('accs-input').value.trim();
  if(!txt){ alert('Ajoute au moins un compte !\nFormat : username|password'); return; }

  // Valider format
  var lines=txt.split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
  if(!lines.length){ alert('Aucun compte valide trouvé !'); return; }
  addLog('📋 '+lines.length+' compte(s) trouvé(s)…');

  document.getElementById('btn-start').disabled=true;
  document.getElementById('btn-stop').style.display='block';
  document.getElementById('prog-card').style.display='block';
  document.getElementById('status-badge').className='badge badge-green';
  document.getElementById('status-badge').textContent='▶ En cours';
  allSubs=[]; lastLog=0; renderTable();

  try{
    // Upload + start en une seule requête
    var r=await fetch('/api/start',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({accounts:txt})
    });
    if(!r.ok){ addLog('❌ Erreur serveur: '+r.status); document.getElementById('btn-start').disabled=false; return; }
    var d=await r.json();
    if(d.error){ addLog('❌ '+d.error); document.getElementById('btn-start').disabled=false; return; }
    sessionId=d.sessionId;
    addLog('🚀 Session démarrée: '+sessionId);
    pollTimer=setInterval(poll,2000);
  }catch(e){
    addLog('❌ Connexion échouée: '+e.message);
    document.getElementById('btn-start').disabled=false;
  }
}

async function stop(){
  if(sessionId) await fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId})});
  clearInterval(pollTimer);
  document.getElementById('btn-start').disabled=false;
  document.getElementById('btn-stop').style.display='none';
  document.getElementById('status-badge').className='badge badge-red';
  document.getElementById('status-badge').textContent='⏹ Arrêté';
}

async function poll(){
  if(!sessionId) return;
  try{
    var d=await fetch('/api/session/'+sessionId).then(r=>r.json());
    d.logs.slice(lastLog).forEach(m=>addLog(m)); lastLog=d.logs.length;
    allSubs=d.subs||[];
    var pct=d.total>0?Math.round(allSubs.length/d.total*100):0;
    document.getElementById('prog-fill').style.width=pct+'%';
    document.getElementById('prog-txt').textContent=allSubs.length+' / '+d.total+' ('+pct+'%)';
    document.getElementById('cnt-ok').textContent=allSubs.length;
    document.getElementById('cnt-main').textContent=(d.mains||[]).length;
    document.getElementById('cnt-target').textContent=d.total;
    document.getElementById('sub-count').textContent=allSubs.length+' sous-compte(s)';
    renderTable();
    if(!d.running){
      clearInterval(pollTimer);
      document.getElementById('btn-start').disabled=false;
      document.getElementById('btn-stop').style.display='none';
      document.getElementById('status-badge').className='badge badge-red';
      document.getElementById('status-badge').textContent='✅ Terminé';
      addLog('🏁 Terminé ! '+allSubs.length+' sous-comptes créés.');
    }
  }catch(e){}
}

function download(){ window.open('/api/results/download','_blank'); }
</script>
</body>
</html>`;

app.get('/', (req, res) => res.send(UI));

app.listen(PORT, () => {
    slog('🚀 SubBot démarré → http://localhost:' + PORT);
    slog('📁 Fichier comptes : ' + ACCOUNTS_FILE);
    slog('📁 Résultats : ' + RESULTS_FILE);
    if(!fs.existsSync(ACCOUNTS_FILE)){
        fs.writeFileSync(ACCOUNTS_FILE, '# Format : username|password|cle2fa (2fa optionnel)\n# Exemple:\n# moncompte|MonMotDePasse123\n# autrecompte|Pass456|JBSWY3DPEHPK3PXP\n', 'utf-8');
        slog('📝 accounts.txt créé (exemple)');
    }
});

SUBBOT_EOF

# Écrire accountInfoGenerator.js
cat > accountInfoGenerator.js << 'GEN_EOF'
const firstNames=['Emma','Lea','Chloe','Manon','Ines','Camille','Jade','Louise','Alice','Lucie','Clara','Sarah','Julie','Pauline','Marine','Eva','Oceane','Nina','Charlotte','Zoe','Liam','Noah','Lucas','Hugo','Nathan','Tom','Theo','Maxime','Antoine','Baptiste','Pierre','Louis','Jules','Ethan','Arthur','Alexis','Romain','Clement','Adrien','Kevin'];
const lastNames=['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel','Girard','Andre','Lefevre','Mercier','Dupont','Lambert','Bonnet','Francois','Martinez'];
const adjectives=['cool','happy','sunny','bright','smart','swift','bold','calm','free','pure'];
const nouns=['sky','moon','star','fire','wave','rock','leaf','bird','fox','wolf'];
function generatingName(){const f=firstNames[Math.floor(Math.random()*firstNames.length)];const l=lastNames[Math.floor(Math.random()*lastNames.length)];return f+' '+l;}
function username(){const mode=Math.floor(Math.random()*4);const num=Math.floor(Math.random()*9999);if(mode===0){const f=firstNames[Math.floor(Math.random()*firstNames.length)].toLowerCase();const l=lastNames[Math.floor(Math.random()*lastNames.length)].toLowerCase();return f+'_'+l+(Math.random()>.5?num:'');}if(mode===1){const a=adjectives[Math.floor(Math.random()*adjectives.length)];const n=nouns[Math.floor(Math.random()*nouns.length)];return a+'_'+n+num;}if(mode===2){const f=firstNames[Math.floor(Math.random()*firstNames.length)].toLowerCase();return f+'.'+num;}let r='';const chars='abcdefghijklmnopqrstuvwxyz';for(let i=0;i<8;i++)r+=chars[Math.floor(Math.random()*chars.length)];return r+num;}
module.exports={generatingName,username};
GEN_EOF

# Écrire package.json
cat > package.json << 'PKG_EOF'
{"name":"instagram-subbot","version":"1.0.0","main":"subBot.js","dependencies":{"express":"^4.18.2","node-fetch":"^2.6.1"}}
PKG_EOF

echo "📦 npm install..."
npm install

echo ""
echo "✅ Installation terminée !"
echo "🌐 Ouvre http://localhost:11000 dans ton navigateur"
echo ""
node subBot.js
