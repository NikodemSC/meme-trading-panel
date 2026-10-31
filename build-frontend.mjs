import { mkdirSync, copyFileSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root=fileURLToPath(new URL(".",import.meta.url));
const output=join(root,"public-site");
const files=["index.html","login.html","app.js","login.js","styles.css","connection.js"];
const allowed=new Set([...files,"frontend-config.js",".nojekyll"]);
mkdirSync(output,{recursive:true});
// Fail rather than accidentally publish an unrelated file left in the output.
for(const name of readdirSync(output))if(!allowed.has(name))throw Error(`Nieoczekiwany plik w public-site: ${name}`);
const savedConfig=existsSync(join(root,"public-panel.json"))?JSON.parse(readFileSync(join(root,"public-panel.json"),"utf8")):{};
const apiBase=(process.env.MEME_PILOT_PUBLIC_API??savedConfig.apiBase??"").replace(/\/$/,"");
if(apiBase){
  const url=new URL(apiBase);
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/")throw Error("Adres silnika musi być adresem HTTPS bez ścieżki i danych logowania.");
}
for(const name of files)copyFileSync(join(root,name),join(output,name));
writeFileSync(join(output,"frontend-config.js"),`window.MEME_PILOT_CONFIG = ${JSON.stringify({apiBase,staticPanel:true})};\n`);
writeFileSync(join(output,".nojekyll"),"");
console.log("Gotowe: public-site/ — wyłącznie publiczny panel, bez silnika, kont i kluczy.");
if(!apiBase)console.log("Panel pokaże brak konfiguracji do czasu ustawienia MEME_PILOT_PUBLIC_API i ponownego zbudowania.");

