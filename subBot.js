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
<title>SubBot</title>
<style>
:root{--bg:#08080f;--s:#10101a;--b:#1c1c2a;--accent:#e1306c;--a2:#f77737;--green:#00d68f;--blue:#3b82f6;--yellow:#f59e0b;--text:#eef0f5;--muted:#4a4a6a;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}
.top{position:sticky;top:0;z-index:99;background:rgba(8,8,15,.95);backdrop-filter:blur(16px);border-bottom:1px solid var(--b);display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:52px;}
.logo{font-weight:800;font-size:.95rem;background:linear-gradient(135deg,var(--accent),var(--a2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.badge{padding:3px 12px;border-radius:20px;font-size:.72rem;font-weight:700;}
.badge-red{background:rgba(225,48,108,.12);color:var(--accent);}
.badge-green{background:rgba(0,214,143,.12);color:var(--green);}
.layout{display:grid;grid-template-columns:280px 1fr;min-height:calc(100vh - 52px);}
.side{background:var(--s);border-right:1px solid var(--b);padding:20px;display:flex;flex-direction:column;gap:14px;}
.main-area{padding:24px;overflow-y:auto;}
.card{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:14px;}
.lbl{font-size:.62rem;text-transform:uppercase;letter-spacing:2px;color:var(--muted);margin-bottom:8px;font-weight:700;}
textarea{width:100%;height:120px;background:var(--bg);border:1px solid var(--b);border-radius:8px;color:var(--text);font-family:monospace;font-size:.75rem;padding:10px;resize:vertical;outline:none;line-height:1.6;}
textarea:focus{border-color:var(--accent);}
.hint{font-size:.65rem;color:var(--muted);margin-top:6px;line-height:1.5;}
.btn{width:100%;padding:12px;border:none;border-radius:10px;font-size:.88rem;font-weight:800;cursor:pointer;transition:.15s;}
.btn-go{background:linear-gradient(135deg,var(--accent),var(--a2));color:#fff;box-shadow:0 4px 20px rgba(225,48,108,.3);}
.btn-go:hover:not(:disabled){transform:translateY(-1px);}
.btn-go:disabled{opacity:.4;cursor:not-allowed;}
.btn-stop{background:rgba(225,48,108,.1);color:var(--accent);border:1px solid rgba(225,48,108,.3);}
.btn-dl{background:rgba(59,130,246,.1);color:var(--blue);border:1px solid rgba(59,130,246,.3);}
.prog-track{height:4px;background:var(--b);border-radius:2px;margin:8px 0;overflow:hidden;}
.prog-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--a2));border-radius:2px;width:0;transition:width .5s;}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px;}
.stat{background:var(--bg);border:1px solid var(--b);border-radius:8px;padding:8px;text-align:center;}
.stat .n{font-size:1.1rem;font-weight:800;font-family:monospace;}
.ng{color:var(--green)}.nb{color:#f87171}.ny{color:var(--yellow)}
.logbox{height:180px;overflow-y:auto;font-family:monospace;font-size:.65rem;padding:8px;background:var(--bg);border-radius:8px;}
.ll{padding:2px 0;border-bottom:1px solid rgba(255,255,255,.03);word-break:break-all;}
.lok{color:var(--green)}.ler{color:#f87171}.lwa{color:var(--yellow)}.lin{color:var(--blue)}.ldf{color:#666}
.tbl{width:100%;border-collapse:collapse;font-size:.78rem;}
.tbl th{font-size:.6rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);padding:8px 10px;text-align:left;border-bottom:1px solid var(--b);}
.tbl td{padding:8px 10px;border-bottom:1px solid var(--b);}
.tag{background:rgba(225,48,108,.12);color:var(--accent);padding:1px 8px;border-radius:20px;font-size:.65rem;font-weight:700;}
.cpbtn{background:transparent;border:1px solid var(--b);color:var(--muted);border-radius:5px;padding:2px 8px;cursor:pointer;font-size:.65rem;}
.cpbtn:hover{color:var(--text);border-color:var(--accent);}
.empty{text-align:center;padding:60px;color:var(--muted);}
@media(max-width:750px){.layout{grid-template-columns:1fr}.side{border-right:none;border-bottom:1px solid var(--b)}}
</style>
</head>
<body>

<div class="top">
  <div class="logo">&#x1F916; SubBot Instagram</div>
  <div id="sbadge" class="badge badge-red">&#x23F9; Arrete</div>
</div>

<div class="layout">
<div class="side">
  <div class="card">
    <div class="lbl">Comptes principaux</div>
    <textarea id="accs" placeholder="username|password&#10;username|password|2FA&#10;..."></textarea>
    <div class="hint">Format : username|password<br>Avec 2FA : username|password|CLE2FA<br>Un compte par ligne</div>
    <div id="accs-count" style="font-size:.7rem;color:var(--muted);margin-top:6px;"></div>
  </div>

  <button class="btn btn-go" id="btnGo">&#x1F680; Lancer le bot</button>
  <button class="btn btn-stop" id="btnStop" style="display:none">&#x23F9; Arreter</button>
  <button class="btn btn-dl" onclick="dlResults()">&#x2B07;&#xFE0F; Telecharger results.txt</button>

  <div id="progCard" style="display:none" class="card">
    <div class="lbl">Progression</div>
    <div class="prog-track"><div class="prog-fill" id="progFill"></div></div>
    <div id="progTxt" style="font-size:.7rem;color:var(--muted);text-align:center;margin-bottom:6px;"></div>
    <div class="stats">
      <div class="stat"><div class="n ng" id="cntOk">0</div><div style="font-size:.6rem;color:var(--muted)">Crees</div></div>
      <div class="stat"><div class="n ny" id="cntMain">0</div><div style="font-size:.6rem;color:var(--muted)">Mains</div></div>
      <div class="stat"><div class="n nb" id="cntTarget">0</div><div style="font-size:.6rem;color:var(--muted)">Cible</div></div>
    </div>
  </div>

  <div class="card">
    <div class="lbl">Logs</div>
    <div class="logbox" id="logbox"></div>
  </div>
</div>

<div class="main-area">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
    <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:2px;">Sous-comptes crees</div>
    <div id="subCount" style="font-size:.78rem;color:var(--muted);"></div>
  </div>
  <div id="tableWrap"><div class="empty">&#x1F4F1; Lance le bot pour voir les sous-comptes ici</div></div>
</div>
</div>

<script>
var SID=null, timer=null, lastLog=0, allSubs=[];

document.getElementById('accs').addEventListener('input',function(){
  var n=this.value.split('\n').filter(function(l){return l.trim()&&!l.startsWith('#');}).length;
  document.getElementById('accs-count').textContent=n+' compte(s)';
});

document.getElementById('btnGo').addEventListener('click', startBot);
document.getElementById('btnStop').addEventListener('click', stopBot);

function log(msg,cls){
  var b=document.getElementById('logbox');
  var d=document.createElement('div');
  d.className='ll '+(cls||'ldf');
  d.textContent=new Date().toLocaleTimeString()+' '+msg;
  b.insertBefore(d,b.firstChild);
  if(b.children.length>200) b.removeChild(b.lastChild);
}

function copyText(t){
  try{navigator.clipboard.writeText(t);}catch(e){
    var x=document.createElement('textarea');x.value=t;
    document.body.appendChild(x);x.select();document.execCommand('copy');
    document.body.removeChild(x);
  }
}

function renderTable(){
  var w=document.getElementById('tableWrap');
  if(!allSubs.length){w.innerHTML='<div class="empty">&#x1F4F1; Aucun sous-compte encore</div>';return;}
  var rows=allSubs.slice().reverse().map(function(s){
    var key=s.uName+'|'+s.password+'|'+s.email;
    return '<tr><td><span class="tag">'+s.mainUser+'</span></td><td>@'+s.uName+'</td><td>'+s.email+'</td><td>'+s.password+'</td><td>'+new Date(s.createdAt).toLocaleTimeString()+'</td><td><button class="cpbtn" onclick="copyText('+JSON.stringify(key)+')">Copier</button></td></tr>';
  }).join('');
  w.innerHTML='<table class="tbl"><thead><tr><th>Principal</th><th>Sous-compte</th><th>Email</th><th>Mot de passe</th><th>Heure</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
}

async function startBot(){
  var txt=document.getElementById('accs').value.trim();
  if(!txt){alert('Entre au moins un compte !');return;}
  var lines=txt.split('\n').filter(function(l){return l.trim()&&!l.startsWith('#');});
  if(!lines.length){alert('Aucun compte valide !');return;}

  document.getElementById('btnGo').disabled=true;
  document.getElementById('btnStop').style.display='block';
  document.getElementById('progCard').style.display='block';
  document.getElementById('sbadge').className='badge badge-green';
  document.getElementById('sbadge').textContent='En cours...';
  allSubs=[];lastLog=0;renderTable();
  log('Envoi de '+lines.length+' compte(s)...','lin');

  try{
    var resp=await fetch('/api/start',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({accounts:txt})
    });
    var data=await resp.json();
    if(data.error){log('ERREUR: '+data.error,'ler');document.getElementById('btnGo').disabled=false;return;}
    SID=data.sessionId;
    log('Session: '+SID,'lin');
    timer=setInterval(poll,2000);
  }catch(e){
    log('Erreur connexion: '+e.message,'ler');
    document.getElementById('btnGo').disabled=false;
  }
}

async function stopBot(){
  if(SID) await fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:SID})}).catch(function(){});
  clearInterval(timer);
  document.getElementById('btnGo').disabled=false;
  document.getElementById('btnStop').style.display='none';
  document.getElementById('sbadge').className='badge badge-red';
  document.getElementById('sbadge').textContent='Arrete';
}

async function poll(){
  if(!SID) return;
  try{
    var d=await fetch('/api/session/'+SID).then(function(r){return r.json();});
    d.logs.slice(lastLog).forEach(function(m){
      var cls='ldf';
      if(m.includes('OK')||m.includes('cree')||m.includes('eussi')) cls='lok';
      else if(m.includes('ERREUR')||m.includes('echec')||m.includes('Echec')) cls='ler';
      else if(m.includes('Pause')||m.includes('Attente')) cls='lwa';
      else if(m.includes('Demarra')||m.includes('Login')||m.includes('Etape')) cls='lin';
      log(m,cls);
    });
    lastLog=d.logs.length;
    allSubs=d.subs||[];
    var pct=d.total>0?Math.round(allSubs.length/d.total*100):0;
    document.getElementById('progFill').style.width=pct+'%';
    document.getElementById('progTxt').textContent=allSubs.length+' / '+d.total+' ('+pct+'%)';
    document.getElementById('cntOk').textContent=allSubs.length;
    document.getElementById('cntMain').textContent=(d.mains||[]).length;
    document.getElementById('cntTarget').textContent=d.total;
    document.getElementById('subCount').textContent=allSubs.length+' sous-compte(s)';
    renderTable();
    if(!d.running){
      clearInterval(timer);
      document.getElementById('btnGo').disabled=false;
      document.getElementById('btnStop').style.display='none';
      document.getElementById('sbadge').className='badge badge-red';
      document.getElementById('sbadge').textContent='Termine';
      log('Termine ! '+allSubs.length+' sous-comptes crees.','lok');
    }
  }catch(e){}
}

function dlResults(){window.open('/api/results/download','_blank');}
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
