# 🤖 SubBot — Création automatique de sous-comptes Instagram

## 📋 Description
Ce bot se connecte à tes comptes Instagram principaux et crée automatiquement **10 sous-comptes** par compte principal. Chaque sous-compte est sauvegardé dans `results.txt` et envoyé au panel admin.

## 🚀 Installation

### Sur Termux (Android)
```bash
pkg install nodejs git
git clone https://github.com/TON_USERNAME/instagram-subbot
cd instagram-subbot
npm install
node subBot.js
```

### Sur PC Windows
```bash
git clone https://github.com/TON_USERNAME/instagram-subbot
cd instagram-subbot
npm install
node subBot.js
```

## 📁 Format accounts.txt
```
# Un compte par ligne (les lignes # sont ignorées)
username|password
username|password|CLE2FA
moncompte|MonMotDePasse123
autrecompte|Pass456|JBSWY3DPEHPK3PXP
```

## 🌐 Interface
Ouvre `http://localhost:11000` dans ton navigateur.

1. Colle tes comptes principaux dans la zone de texte
2. Clique **Lancer le bot**
3. Regarde les sous-comptes se créer en temps réel
4. Télécharge `results.txt` à la fin

## 📦 results.txt
Format de sortie :
```
compte_principal|sous_compte|mot_de_passe|email
```

## ⚙️ Variables d'environnement (optionnel)
```bash
PANEL_URL=https://ton-panel.render.com   # Panel admin
LICENSE_KEY=ta-cle-licence               # Clé licence
PORT=11000                               # Port (défaut 11000)
```

## ⚠️ Notes
- Délai de 8-13s entre chaque sous-compte (anti-ban)
- Délai de 15s entre chaque compte principal
- Si 3 échecs consécutifs → passe au compte suivant
- Les sous-comptes utilisent des emails temporaires
