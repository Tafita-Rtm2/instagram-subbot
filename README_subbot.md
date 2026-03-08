# 🤖 SubBot — Création automatique de sous-comptes Instagram

## ⚡ LANCEMENT RAPIDE — Termux (3 commandes)

**Commande 1 :**
```
rm -rf ~/subbot && mkdir ~/subbot && cd ~/subbot && curl -L -o subBot.js "https://raw.githubusercontent.com/Tafita-Rtm2/instagram-subbot/main/subBot.js"
```

**Commande 2 :**
```
cat > ~/subbot/accountInfoGenerator.js << 'EOF'
const firstNames=['Emma','Lea','Chloe','Manon','Ines','Camille','Jade','Louise','Alice','Lucie','Clara','Sarah','Julie','Pauline','Marine','Eva','Oceane','Nina','Charlotte','Zoe','Liam','Noah','Lucas','Hugo','Nathan','Tom','Theo','Maxime','Antoine','Baptiste','Pierre','Louis','Jules','Ethan','Arthur','Alexis','Romain','Clement','Adrien','Kevin'];
const lastNames=['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel','Girard','Andre','Lefevre','Mercier','Dupont','Lambert','Bonnet','Francois','Martinez'];
const adjectives=['cool','happy','sunny','bright','smart','swift','bold','calm','free','pure'];
const nouns=['sky','moon','star','fire','wave','rock','leaf','bird','fox','wolf'];
function generatingName(){const f=firstNames[Math.floor(Math.random()*firstNames.length)];const l=lastNames[Math.floor(Math.random()*lastNames.length)];return f+' '+l;}
function username(){const mode=Math.floor(Math.random()*4);const num=Math.floor(Math.random()*9999);if(mode===0){const f=firstNames[Math.floor(Math.random()*firstNames.length)].toLowerCase();const l=lastNames[Math.floor(Math.random()*lastNames.length)].toLowerCase();return f+'_'+l+(Math.random()>.5?num:'');}if(mode===1){const a=adjectives[Math.floor(Math.random()*adjectives.length)];const n=nouns[Math.floor(Math.random()*nouns.length)];return a+'_'+n+num;}if(mode===2){const f=firstNames[Math.floor(Math.random()*firstNames.length)].toLowerCase();return f+'.'+num;}let r='';const chars='abcdefghijklmnopqrstuvwxyz';for(let i=0;i<8;i++)r+=chars[Math.floor(Math.random()*chars.length)];return r+num;}
module.exports={generatingName,username};
EOF
```

**Commande 3 :**
```
cat > ~/subbot/package.json << 'EOF'
{"name":"instagram-subbot","version":"1.0.0","main":"subBot.js","dependencies":{"express":"^4.18.2","node-fetch":"^2.6.1"}}
EOF
cd ~/subbot && npm install && node subBot.js
```

---

## 🔄 Redémarrage rapide (si déjà installé)
```
pkill -f "node subBot" ; cd ~/subbot && node subBot.js
```

## 🔄 Mise à jour
```
pkill -f "node subBot" ; cd ~/subbot && curl -L -o subBot.js "https://raw.githubusercontent.com/Tafita-Rtm2/instagram-subbot/main/subBot.js" && node subBot.js
```

---

## 🌐 Interface : http://localhost:11000

1. Colle tes comptes dans la zone de texte
2. Format : username|password ou username|password|CLE2FA
3. Clique Lancer le bot
4. Télécharge results.txt à la fin

---

## 📁 Format comptes
```
malagasychatgptplus|Tafitaniaina1206
moncompte2|MotDePasse456
autrecompte|Pass789|JBSWY3DPEHPK3PXP
```

## 📦 Format résultats (results.txt)
```
compte_principal|sous_compte|mot_de_passe|email
```
