cat > ~/subbot/accountInfoGenerator.js << 'ENDOFFILE'
const firstNames = ['Emma','Lea','Chloe','Manon','Ines','Camille','Jade','Louise','Alice','Lucie','Clara','Sarah','Julie','Pauline','Marine','Eva','Oceane','Nina','Charlotte','Zoe','Liam','Noah','Lucas','Hugo','Nathan','Tom','Theo','Maxime','Antoine','Baptiste','Pierre','Louis','Jules','Ethan','Arthur','Alexis','Romain','Clement','Adrien','Kevin'];
const lastNames = ['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel','Girard','Andre','Lefevre','Mercier','Dupont','Lambert','Bonnet','Francois','Martinez'];
const adjectives = ['cool','happy','sunny','bright','smart','swift','bold','calm','free','pure'];
const nouns = ['sky','moon','star','fire','wave','rock','leaf','bird','fox','wolf'];

function generatingName(){
  const f=firstNames[Math.floor(Math.random()*firstNames.length)];
  const l=lastNames[Math.floor(Math.random()*lastNames.length)];
  return f+' '+l;
}

function username(){
  const mode=Math.floor(Math.random()*4);
  const num=Math.floor(Math.random()*9999);
  if(mode===0){const f=firstNames[Math.floor(Math.random()*firstNames.length)].toLowerCase();const l=lastNames[Math.floor(Math.random()*lastNames.length)].toLowerCase();return f+'_'+l+(Math.random()>.5?num:'');}
  if(mode===1){const a=adjectives[Math.floor(Math.random()*adjectives.length)];const n=nouns[Math.floor(Math.random()*nouns.length)];return a+'_'+n+num;}
  if(mode===2){const f=firstNames[Math.floor(Math.random()*firstNames.length)].toLowerCase();return f+'.'+num;}
  let r='';const chars='abcdefghijklmnopqrstuvwxyz';
  for(let i=0;i<8;i++)r+=chars[Math.floor(Math.random()*chars.length)];
  return r+num;
}

module.exports={generatingName,username};
ENDOFFILE
