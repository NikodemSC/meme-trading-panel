import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUMP_PROGRAM, SOL_MINT, pumpEvents, curveMarketCapSol, readMetadata, externalUrl } from "./market-data.mjs";
import { PaperPortfolio } from "./paper-portfolio.mjs";
import { ManagerEngine } from "./manager-engine.mjs";
import { CopyEngine } from "./copy-engine.mjs";
import { NamedEnginePortfolio } from "./named-engine-portfolio.mjs";
import { buildPaperStats } from "./paper-stats.mjs";
import { evaluateEntry, strategyFieldCatalog } from "./strategy-engine.mjs";
import { RollingMarketMetrics } from "./live-metrics.mjs";
import { AccountStore, sessionToken, sessionCookie, clearSessionCookie } from "./auth.mjs";
import { applyCors } from "./cors.mjs";
import { restorePublicSnapshot, savePublicSnapshot } from "./supabase-state.mjs";
const root = new URL("./", import.meta.url), env = {};
if (existsSync(new URL(".env",root))) for (const line of readFileSync(new URL(".env",root),"utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)\s*=\s*(.*)$/); if(m) env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,"");
}
const config={...env,...process.env}, rpc=config.SOLANA_RPC_URL||"https://api.mainnet-beta.solana.com";
const allowedOrigins=String(config.MEME_PILOT_FRONTEND_ORIGINS||"").split(",").map(value=>value.trim()).filter(Boolean);
const dataDir=resolve(config.MEME_PILOT_DATA_DIR||fileURLToPath(new URL("data/",root)));
mkdirSync(dataDir,{recursive:true});
const accounts=new AccountStore(dataDir);
// Public paper-trading mode: one shared guest workspace, no password or account picker.
const publicUser={id:"public",name:""};
const programs=["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const tokens=[],queue=[],seen=new Set(),mints=new Set(),subscriptions=new Set();
const status={connected:false,message:"Łączenie z Solaną…",detected:0,missed:0,lastEvent:null};
const byMint=new Map(),metadataQueue=[],metadataPending=new Set(),pumpSeen=new Set();
const quotePrices=new Map([[SOL_MINT,{decimals:9,price:null,at:0}]]);
let metadataBusy=0,marketBusy=false,marketCursor=0,solPriceUsd=null,solPriceAt=0;
let copyPollBusy=false;
const holderFilterKeys=["minHolders","maxHolders","minTopHolderPercent","maxTopHolderPercent","minTop10HoldersPercent","maxTop10HoldersPercent"];
let holderBusy=false,holderCursor=0;
const eventClients=new Set();
const liveMetrics=new RollingMarketMetrics();
let marketNoticeTimer=null;
function publishEvent(type,payload={}){
  const frame=`data: ${JSON.stringify({type,payload,at:new Date().toISOString()})}\n\n`;
  for(const client of eventClients){
    if(!client.public&&!accounts.resolve(client.token)){client.res.end();eventClients.delete(client);continue;}
    if(payload.userId&&payload.userId!==client.userId)continue;
    try{client.res.write(frame)}catch{eventClients.delete(client)}
  }
}
function notifyMarket(){
  if(marketNoticeTimer)return;
  marketNoticeTimer=setTimeout(()=>{marketNoticeTimer=null;publishEvent("market")},200);
}
const portfolios=new Map();
const managers=new Map();
const copies=new Map();
function portfolioFor(userId){
  if(!portfolios.has(userId)){
    const userDataDir=join(dataDir,"users",userId);
    mkdirSync(userDataDir,{recursive:true});
    portfolios.set(userId,new PaperPortfolio({dataDir:userDataDir,getToken:mint=>byMint.get(mint),publish:(type,payload)=>publishEvent(type,{...payload,userId})}));
  }
  return portfolios.get(userId);
}
function managerFor(userId){
  if(!managers.has(userId)){
    const userDataDir=join(dataDir,"users",userId);
    mkdirSync(userDataDir,{recursive:true});
    managers.set(userId,new NamedEnginePortfolio({dataDir:userDataDir,registryFile:"manager-wallets.json",filePrefix:"manager-wallet",defaultFile:"manager.json",defaultName:"Menadżer 1",EngineClass:ManagerEngine,getToken:mint=>byMint.get(mint),publish:(type,payload)=>publishEvent(type,{...payload,userId})}));
  }
  return managers.get(userId);
}
function copyFor(userId){
  if(!copies.has(userId)){
    const userDataDir=join(dataDir,"users",userId);
    mkdirSync(userDataDir,{recursive:true});
    copies.set(userId,new NamedEnginePortfolio({dataDir:userDataDir,registryFile:"copy-wallets.json",filePrefix:"copy-wallet",defaultFile:"copy.json",defaultName:"Copy 1",EngineClass:CopyEngine,getToken:mint=>byMint.get(mint),publish:(type,payload)=>publishEvent(type,{...payload,userId})}));
  }
  return copies.get(userId);
}
function importLegacyPaperData(userId){
  const destination=join(dataDir,"users",userId);
  mkdirSync(destination,{recursive:true});
  for(const name of readdirSync(dataDir)){
    if(/^paper-(?:trading|wallets|wallet-[a-f0-9-]+)\.json$/.test(name))copyFileSync(join(dataDir,name),join(destination,name));
  }
}
await restorePublicSnapshot(dataDir);
for(const userId of accounts.userIds()){portfolioFor(userId);managerFor(userId);copyFor(userId);}
function upsertToken(values) {
  let token=byMint.get(values.mint);
  if(token){
    for(const [key,value] of Object.entries(values))if(value!==null&&value!==undefined&&(!token[key]||["standard","name","symbol","uri","source","supply","quoteMint","createdAt"].includes(key)))token[key]=value;
  }else{
    token={...values};byMint.set(token.mint,token);mints.add(token.mint);tokens.unshift(token);status.detected++;
    if(tokens.length>2000){const protectedMints=new Set([...managers.values()].flatMap(portfolio=>[...portfolio.engines.values()].flatMap(item=>item.state.trackedMints||[])));for(const portfolio of copies.values())for(const engine of portfolio.engines.values())for(const position of engine.state.positions.filter(item=>item.status==="OPEN"))protectedMints.add(position.mint);const removeIndex=tokens.findIndex(item=>!protectedMints.has(item.mint));const removed=tokens.splice(removeIndex<0?tokens.length-1:removeIndex,1)[0];byMint.delete(removed.mint);mints.delete(removed.mint);liveMetrics.drop(removed.mint);}
  }
  if(token.uri&&!token.image&&!metadataPending.has(token.mint)&&metadataQueue.length<1000){metadataPending.add(token.mint);metadataQueue.push({mint:token.mint,uri:token.uri,attempts:0});}
  return token;
}
async function loadMetadata(){
  if(metadataBusy>=3||!metadataQueue.length)return;
  const job=metadataQueue.shift();metadataBusy++;
  try{
    const metadata=await readMetadata(job.uri),token=byMint.get(job.mint);
    if(metadata&&token){if(metadata.image)token.image=metadata.image;if(!token.name)token.name=metadata.name;if(!token.symbol)token.symbol=metadata.symbol;}
    metadataPending.delete(job.mint);
  }catch{if(++job.attempts<3)metadataQueue.push(job);else metadataPending.delete(job.mint);}
  finally{metadataBusy--;}
}
function ingestPump(event,signature,slot){
  let token=byMint.get(event.mint);
  if(event.type==="create"){
    token=upsertToken({mint:event.mint,name:event.name,symbol:event.symbol,uri:event.uri,source:"Pump.fun",standard:null,signature,createdAt:new Date(event.timestamp*1000).toISOString(),detectedAt:new Date().toISOString(),supply:event.supply,quoteMint:event.quoteMint});
    if(token.marketSlot>slot||token.mcSource==="Pump.fun · transakcja")return;
    token.virtualTokens=event.virtualTokens;token.virtualQuote=event.virtualQuote;token.realTokens=event.realTokens;
    if(event.realTokens>0&&!token.initialRealTokens)token.initialRealTokens=event.realTokens;
    token.mcSource="Pump.fun · utworzenie";
  }else if(token?.source==="Pump.fun"&&!token.migrated&&token.quoteMint===event.quoteMint){
    if(token.marketSlot>slot)return;
    token.virtualTokens=event.virtualTokens;token.virtualQuote=event.virtualQuote;token.realTokens=event.realTokens;token.mcSource="Pump.fun · transakcja";
  }else return;
  token.marketSlot=slot;token.mcUpdatedAt=new Date().toISOString();pricePumpToken(token);
  if(event.type==="create"&&token.marketCapSol>0&&!token.launchMarketCapSol)token.launchMarketCapSol=token.marketCapSol;
  if(event.type==="create"&&token.marketCapUsd>0&&!token.launchMarketCapUsd)token.launchMarketCapUsd=token.marketCapUsd;
  if(token.launchMarketCapSol>0&&token.marketCapSol>0)token.priceChangeFromLaunchPercent=(token.marketCapSol/token.launchMarketCapSol-1)*100;
  if(token.initialRealTokens>0&&Number.isFinite(token.realTokens))token.bondingCurveProgressPercent=Math.max(0,Math.min(100,(1-token.realTokens/token.initialRealTokens)*100));
  token.migratedFlag=token.migrated?1:0;
  liveMetrics.update(token,event,quotePrices.get(token.quoteMint));
  for(const paper of portfolios.values())paper.onMarketUpdate(token);
  for(const manager of managers.values())manager.onMarketUpdate(token);
  for(const copy of copies.values())copy.onMarketUpdate(token);
  notifyMarket();
}
function pricePumpToken(token){
  if(token.source!=="Pump.fun"||token.migrated||!token.virtualTokens||!token.virtualQuote)return;
  const quote=quotePrices.get(token.quoteMint);
  if(token.quoteMint===SOL_MINT)token.marketCapSol=curveMarketCapSol(token.supply,token.virtualTokens,token.virtualQuote);
  if(!quote?.price||!Number.isInteger(quote.decimals))return;
  const value=token.supply/token.virtualTokens*token.virtualQuote/10**quote.decimals*quote.price;
  if(!Number.isFinite(value)||value<=0)return;
  token.marketCapUsd=value;token.usdRateAt=quote.at;
  if(solPriceUsd)token.marketCapSol=value/solPriceUsd;
  if(!token.launchMarketCapUsd&&token.launchMarketCapSol>0&&solPriceUsd)token.launchMarketCapUsd=token.launchMarketCapSol*solPriceUsd;
}
function portfolioNeedsHolders(token){
  for(const portfolio of portfolios.values())for(const engine of portfolio.engines.values()){
    const config=engine.state.config;
    if(!holderFilterKeys.some(key=>config[key]!==null&&config[key]!==undefined))continue;
    const withoutHolders={...config};for(const key of holderFilterKeys)withoutHolders[key]=null;
    if(evaluateEntry(token,withoutHolders,{openPositions:0,hasPosition:false,pending:false,tradedBefore:false}).pass)return true;
  }
  return false;
}
async function readHolderAccounts(token,programId){
  const filters=[{memcmp:{offset:0,bytes:token.mint}}];
  if(programId===programs[0])filters.unshift({dataSize:165});
  const response=await fetch(rpc,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getProgramAccounts",params:[programId,{encoding:"base64",commitment:"confirmed",dataSlice:{offset:32,length:40},filters}]}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error("Holder RPC");
  const payload=await response.json();if(payload.error)throw Error(payload.error.message||"Holder RPC");
  return Array.isArray(payload.result)?payload.result:[];
}
async function updateOneHolderMetric(){
  if(holderBusy||!tokens.length)return;
  const now=Date.now();let token=null;
  for(let checked=0;checked<tokens.length;checked++){
    const candidate=tokens[holderCursor%tokens.length];holderCursor=(holderCursor+1)%Math.max(1,tokens.length);
    if(!candidate||!portfolioNeedsHolders(candidate))continue;
    const last=Date.parse(candidate.holdersUpdatedAt||candidate.holdersCheckedAt||"");
    if(Number.isFinite(last)&&now-last<30000)continue;
    token=candidate;break;
  }
  if(!token)return;holderBusy=true;token.holdersCheckedAt=new Date().toISOString();
  try{
    const preferred=token.standard==="Token-2022"?programs[1]:programs[0],alternate=preferred===programs[0]?programs[1]:programs[0];
    let accounts=await readHolderAccounts(token,preferred);if(!accounts.length)accounts=await readHolderAccounts(token,alternate);
    const balances=new Map();
    for(const item of accounts){
      const encoded=Array.isArray(item?.account?.data)?item.account.data[0]:null;if(!encoded)continue;
      const data=Buffer.from(encoded,"base64");if(data.length<40)continue;
      const amount=data.readBigUInt64LE(32);if(amount<=0n)continue;
      const owner=data.subarray(0,32).toString("hex");balances.set(owner,(balances.get(owner)||0n)+amount);
    }
    const ordered=[...balances.values()].sort((a,b)=>a===b?0:a>b?-1:1),total=ordered.reduce((sum,value)=>sum+value,0n);
    token.holderCount=ordered.length;
    token.topHolderPercent=total>0n&&ordered[0]?Number(ordered[0]*10000n/total)/100:0;
    const top10=ordered.slice(0,10).reduce((sum,value)=>sum+value,0n);
    token.top10HoldersPercent=total>0n?Number(top10*10000n/total)/100:0;
    token.holdersUpdatedAt=new Date().toISOString();token.holdersSource="Solana RPC";delete token.holdersError;
    for(const portfolio of portfolios.values())portfolio.onMarketUpdate(token);notifyMarket();
  }catch(error){token.holdersError=String(error?.message||"Brak danych holderów");}
  finally{holderBusy=false;}
}
async function updateMarkets(){
  if(marketBusy)return;marketBusy=true;
  try{
    // Two batches (max 30 addresses each): recent tokens plus a rolling older batch.
    const recent=tokens.slice(0,29),older=tokens.slice(29);
    const batch=[...recent,...older.slice(marketCursor,marketCursor+30)];
    marketCursor=older.length?(marketCursor+30)%older.length:0;
    const quoteMints=[...new Set(tokens.filter(t=>t.source==="Pump.fun").map(t=>t.quoteMint).filter(Boolean))];
    const addresses=[...new Set([SOL_MINT,...quoteMints,...batch.map(t=>t.mint)])],pairs=[];
    for(let i=0;i<addresses.length;i+=30){
      const response=await fetch("https://api.dexscreener.com/tokens/v1/solana/"+addresses.slice(i,i+30).join(","),{signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error("Market feed");const result=await response.json();if(Array.isArray(result))pairs.push(...result);
    }
    const solPair=pairs.filter(p=>p.baseToken?.address===SOL_MINT&&Number(p.priceUsd)>0).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
    if(solPair){solPriceUsd=Number(solPair.priceUsd);solPriceAt=Date.now();quotePrices.set(SOL_MINT,{price:solPriceUsd,decimals:9,at:solPriceAt});}
    for(const mint of quoteMints.filter(m=>m!==SOL_MINT)){
      const pair=pairs.filter(p=>p.baseToken?.address===mint&&Number(p.priceUsd)>0).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];if(!pair)continue;
      let decimals=quotePrices.get(mint)?.decimals;
      if(!Number.isInteger(decimals)){
        try{
          const response=await fetch(rpc,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getTokenSupply",params:[mint,{commitment:"confirmed"}]}),signal:AbortSignal.timeout(4000)});
          const payload=await response.json();decimals=payload.result?.value?.decimals;
        }catch{}
      }
      quotePrices.set(mint,{price:Number(pair.priceUsd),decimals,at:Date.now()});
    }
    const now=new Date().toISOString();
    for(const token of tokens){
      pricePumpToken(token);
    }
    for(const token of batch){
      const pair=pairs.filter(p=>p.baseToken?.address===token.mint&&p.chainId==="solana").sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
      if(!pair)continue;
      if(!token.name)token.name=pair.baseToken.name;if(!token.symbol)token.symbol=pair.baseToken.symbol;
      if(!token.image)token.image=externalUrl(pair.info?.imageUrl);
      const pairPrice=Number(pair.priceUsd);if(Number.isFinite(pairPrice)&&pairPrice>0)token.priceUsd=pairPrice;
      const pairFdv=Number(pair.fdv);if(Number.isFinite(pairFdv)&&pairFdv>=0)token.fdvUsd=pairFdv;
      const pairCreatedAt=Number(pair.pairCreatedAt);
      if(Number.isFinite(pairCreatedAt)&&pairCreatedAt>0){token.dexPairCreatedAt=new Date(pairCreatedAt).toISOString();token.dexPairAgeMinutes=Math.max(0,(Date.now()-pairCreatedAt)/60000);}
      if(Number(pair.liquidity?.usd)>=0)token.liquidityUsd=Number(pair.liquidity.usd);
      for(const [apiWindow,label] of [["m5","5m"],["h1","1h"],["h6","6h"],["h24","24h"]]){
        const volume=Number(pair.volume?.[apiWindow]);if(Number.isFinite(volume))token[`volume${label}Usd`]=volume;
        const buys=Number(pair.txns?.[apiWindow]?.buys),sells=Number(pair.txns?.[apiWindow]?.sells);
        if(Number.isFinite(buys)&&Number.isFinite(sells)){token[`buys${label}`]=buys;token[`sells${label}`]=sells;token[`transactions${label}`]=buys+sells;token[`buyRatio${label}Percent`]=buys+sells?buys/(buys+sells)*100:0;}
        const change=Number(pair.priceChange?.[apiWindow]);if(Number.isFinite(change))token[`priceChange${label}`]=change;
      }
      if(Number.isFinite(token.priceChange5m))token.momentum=token.priceChange5m;
      const websites=Array.isArray(pair.info?.websites)?pair.info.websites:[],socials=Array.isArray(pair.info?.socials)?pair.info.socials:[];
      token.hasWebsite=websites.some(item=>item?.url)?1:0;
      token.hasTwitter=socials.some(item=>String(item?.type||"").toLowerCase().includes("twitter"))?1:0;
      token.hasTelegram=socials.some(item=>String(item?.type||"").toLowerCase().includes("telegram"))?1:0;
      token.hasProfile=pair.info&&(pair.info.imageUrl||websites.length||socials.length)?1:0;
      token.activeBoosts=Math.max(0,Number(pair.boosts?.active)||0);
      // Do not substitute FDV for market cap. Keep on-chain Pump valuations when available.
      const migrated=token.source==="Pump.fun"&&["pumpswap","raydium","meteora"].includes(pair.dexId)&&Number(pair.liquidity?.usd)>0;
      if((!(token.marketCapSol>0)||migrated||token.migrated)&&Number(pair.marketCap)>0){
        token.migrated ||= migrated;
        token.marketCapUsd=Number(pair.marketCap);token.marketCapSol=solPriceUsd?token.marketCapUsd/solPriceUsd:null;token.mcUpdatedAt=now;token.mcSource="DEX Screener";
      }
      token.migratedFlag=token.migrated?1:0;if(token.migrated)token.bondingCurveProgressPercent=100;
      // Każdy token z aktualną wyceną musi zasilać wszystkie silniki.
      // Dzięki temu Menadżer może kontrolować także token wklejony ręcznie,
      // nawet jeśli nie był wcześniej w puli nowych coinów Pump.fun.
      if(token.marketCapUsd>0){
        for(const paper of portfolios.values())paper.onMarketUpdate(token);
        for(const manager of managers.values())manager.onMarketUpdate(token);
        for(const copy of copies.values())copy.onMarketUpdate(token);
        notifyMarket();
      }
    }
    status.marketError=false;
  }catch{status.marketError=true;}finally{marketBusy=false;}
}
async function pollCopyWallets(){
  if(copyPollBusy)return; copyPollBusy=true;
  try{
    for(const portfolio of copies.values())for(const copy of portfolio.engines.values()){
      const source=copy.state.config.sourceWallet;if(!source)continue;
      const response=await fetch(rpc,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getSignaturesForAddress",params:[source,{limit:20,commitment:"confirmed"}]}),signal:AbortSignal.timeout(8000)});
      const payload=await response.json(),signatures=Array.isArray(payload.result)?payload.result.map(item=>item.signature).filter(Boolean):[];
      if(!signatures.length)continue;
      if(!copy.state.seenSignatures.length){copy.markSignatures(signatures);continue;}
      const fresh=signatures.filter(signature=>!copy.hasSeenSignature(signature)).reverse();
      for(const signature of fresh.slice(-8)){
        try{
          const txResponse=await fetch(rpc,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getParsedTransaction",params:[signature,{maxSupportedTransactionVersion:0,commitment:"confirmed"}]}),signal:AbortSignal.timeout(8000)});
          const tx=(await txResponse.json()).result,meta=tx?.meta;if(!meta)continue;
          const before=new Map((meta.preTokenBalances||[]).filter(item=>item.owner===source).map(item=>[item.mint,Number(item.uiTokenAmount?.uiAmount||0)]));
          const after=new Map((meta.postTokenBalances||[]).filter(item=>item.owner===source).map(item=>[item.mint,Number(item.uiTokenAmount?.uiAmount||0)]));
          for(const mint of new Set([...before.keys(),...after.keys()])){
            const delta=(after.get(mint)||0)-(before.get(mint)||0);if(!Number.isFinite(delta)||Math.abs(delta)<1e-12)continue;
            if(!byMint.has(mint))upsertToken({mint,source:"Pump.fun",name:"Copy token",symbol:"TOKEN",createdAt:new Date().toISOString(),detectedAt:new Date().toISOString()});
            const token=byMint.get(mint),amountUsd=token?.priceUsd>0?Math.abs(delta)*Number(token.priceUsd):copy.state.config.entryAmountUsd;
            copy.onSourceTrade({side:delta>0?"BUY":"SELL",mint,amountUsd,marketCapUsd:token?.marketCapUsd||null,sourceAt:new Date().toISOString()});
          }
        }catch{}
      }
      copy.markSignatures(fresh);
    }
  }catch{}finally{copyPollBusy=false;}
}
let socket,busy=false,lastMessage=0;
function connect(){
  subscriptions.clear();status.connected=false;status.message="Łączenie z Solaną…";
  const currentSocket=new WebSocket(config.SOLANA_WS_URL||rpc.replace(/^http/,"ws"));
  socket=currentSocket;
  currentSocket.addEventListener("open",()=>{
    lastMessage=Date.now();
    // Skaner pokazuje Pump.fun. Subskrypcje wszystkich mintów SPL przeciążały publiczne RPC.
    currentSocket.send(JSON.stringify({jsonrpc:"2.0",id:1,method:"logsSubscribe",params:[{mentions:[PUMP_PROGRAM]},{commitment:"confirmed"}]}));
  });
  currentSocket.addEventListener("message",({data})=>{
    lastMessage=Date.now();let msg;try{msg=JSON.parse(data)}catch{return}
    if(msg.error){status.message="Dostawca odrzucił subskrypcję RPC.";status.connected=false;return}
    if(msg.id&&msg.result!==undefined){subscriptions.add(msg.id);status.connected=subscriptions.size===1;status.message=status.connected?"Nasłuch nowych tokenów":"Łączenie…";return}
    const event=msg.params?.result?.value;if(!event||event.err)return;
    status.lastEvent=new Date().toISOString();
    if(!pumpSeen.has(event.signature)){
      const decoded=pumpEvents(event.logs);
      if(decoded.length){pumpSeen.add(event.signature);if(pumpSeen.size>20000)pumpSeen.delete(pumpSeen.values().next().value);}
      for(const pumpEvent of decoded)ingestPump(pumpEvent,event.signature,msg.params.result.context.slot);
    }
    if(!event.logs?.some(l=>/Instruction: InitializeMint(2)?$/.test(l))||seen.has(event.signature))return;
    seen.add(event.signature);if(seen.size>20000)seen.delete(seen.values().next().value);
    if(queue.length>=2000){status.missed++;return}
    queue.push({signature:event.signature,detectedAt:new Date().toISOString(),attempts:0});
  });
  currentSocket.addEventListener("error",()=>{if(socket===currentSocket)status.connected=false;currentSocket.close()});
  currentSocket.addEventListener("close",()=>{if(socket!==currentSocket)return;status.connected=false;status.message="Połączenie przerwane. Ponawiam…";setTimeout(()=>{if(socket===currentSocket)connect()},4000)});
}
async function decode(){
  if(busy||!queue.length)return;busy=true;const job=queue.shift();
  try{
    const response=await fetch(rpc,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getTransaction",params:[job.signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:0}]}),signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error();const payload=await response.json();if(payload.error||!payload.result)throw Error();
    const tx=payload.result;if(tx.meta?.err)return;
    const instructions=[...(tx.transaction?.message?.instructions||[]),...(tx.meta?.innerInstructions||[]).flatMap(i=>i.instructions)];
    for(const ix of instructions){
      if(!programs.includes(String(ix.programId))||!["initializeMint","initializeMint2"].includes(ix.parsed?.type))continue;
      const info=ix.parsed.info,mint=info.mint;if(!mint)continue;
      const meta=instructions.find(i=>i.parsed?.info?.mint===mint&&i.parsed?.info?.name)?.parsed.info;
      upsertToken({mint,name:meta?.name||null,symbol:meta?.symbol||null,uri:meta?.uri||null,decimals:info.decimals,standard:String(ix.programId)===programs[0]?"SPL":"Token-2022",signature:job.signature,createdAt:tx.blockTime?new Date(tx.blockTime*1000).toISOString():null,detectedAt:job.detectedAt});
    }
    tokens.sort((a,b)=>Date.parse(b.createdAt||b.detectedAt)-Date.parse(a.createdAt||a.detectedAt));status.rpcError=false;
  }catch{
    status.rpcError=true;if(++job.attempts<5)queue.push(job);else status.missed++;
    await new Promise(r=>setTimeout(r,1500));
  }finally{busy=false}
}
function json(res,statusCode,payload){res.writeHead(statusCode,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(payload));}
async function readJson(req){
  let body="";for await(const chunk of req){body+=chunk;if(body.length>65536)throw Error("Żądanie jest za duże.");}
  if(!body)return {};try{return JSON.parse(body)}catch{throw Error("Nieprawidłowe dane.")}
}
const files={"/":["index.html","text/html"],"/index.html":["index.html","text/html"],"/app.js":["app.js","text/javascript"],"/styles.css":["styles.css","text/css"],"/login":["login.html","text/html"],"/login.js":["login.js","text/javascript"]};
files["/login.html"]=files["/login"];
files["/connection.js"]=["connection.js","text/javascript"];
files["/frontend-config.js"]=["frontend-config.js","text/javascript"];
function localRequest(req){
  const address=String(req.socket.remoteAddress||""),host=String(req.headers.host||"").toLowerCase();
  return ["127.0.0.1","::1","::ffff:127.0.0.1"].includes(address)&&/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)&&!req.headers["x-forwarded-for"];
}
function secureCookie(req){return !localRequest(req);}
function serveFile(res,path){
  const file=files[path];if(!file){json(res,404,{error:"Nie znaleziono."});return}
  res.writeHead(200,{"Content-Type":file[1]+"; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(readFileSync(new URL(file[0],root)));
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost"),path=url.pathname;
  const walletId=url.searchParams.get("walletId")||"main";
  try{
    if(!applyCors(req,res,allowedOrigins))return;
    const remoteFrontend=allowedOrigins.includes(req.headers.origin);
    if(req.method==="GET"&&path==="/api/health"){json(res,200,{ok:true,service:"meme-pilot"});return}
    if(!["GET","HEAD"].includes(req.method)&&req.headers["x-meme-pilot-request"]!=="1"){json(res,403,{error:"Niedozwolone żądanie."});return}
    const token=sessionToken(req),user=accounts.resolve(token)||publicUser;
    if(req.method==="GET"&&path==="/api/auth/setup"){json(res,200,{accounts:accounts.slots()});return}
    if(req.method==="POST"&&path==="/api/auth/register"){
      const body=await readJson(req);
      if((!localRequest(req)||remoteFrontend)&&(!config.MEME_PILOT_SETUP_CODE||body.setupCode!==config.MEME_PILOT_SETUP_CODE)){json(res,403,{error:"Pierwsze konto utwórz lokalnie albo podaj kod konfiguracji serwera."});return}
      const created=await accounts.createSlot(body.slot,body.password);
      if(created.slot===1)importLegacyPaperData(created.id);
      portfolioFor(created.id);
      const login=await accounts.login(body.slot,body.password,req.socket.remoteAddress);
      res.setHeader("Set-Cookie",sessionCookie(login.token,secureCookie(req)));
      json(res,201,{user:login.user,...(remoteFrontend?{token:login.token}:{})});return;
    }
    if(req.method==="POST"&&path==="/api/auth/login"){
      const body=await readJson(req),login=await accounts.login(body.slot,body.password,req.socket.remoteAddress);
      res.setHeader("Set-Cookie",sessionCookie(login.token,secureCookie(req)));
      json(res,200,{user:login.user,...(remoteFrontend?{token:login.token}:{})});return;
    }
    if(req.method==="GET"&&["/login","/login.html","/login.js","/styles.css","/connection.js","/frontend-config.js"].includes(path)){
      if(path==="/login"||path==="/login.html"){res.writeHead(302,{Location:"/"});res.end();return}
      serveFile(res,path);return;
    }
    if(req.method==="GET"&&path==="/api/auth/me"){json(res,200,{user});return}
    if(req.method==="POST"&&path==="/api/auth/logout"){
      accounts.logout(token);
      for(const client of eventClients)if(client.token===token){client.res.end();eventClients.delete(client)}
      res.setHeader("Set-Cookie",clearSessionCookie(secureCookie(req)));json(res,200,{ok:true});return;
    }
    const paper=portfolioFor(user.id),manager=managerFor(user.id),copy=copyFor(user.id);
    if(req.method==="GET"&&path==="/api/new-coins"){json(res,200,{tokens:tokens.slice(0,500),status:{...status,tracked:tokens.length,solPriceAt,solPriceUsd,pending:queue.length,publicRpc:rpc.includes("api.mainnet-beta.solana.com")}});return}
    if(req.method==="GET"&&path==="/api/paper"){json(res,200,paper.publicState(walletId));return}
    if(req.method==="GET"&&path==="/api/paper/stats"){json(res,200,buildPaperStats(paper.get(walletId)));return}
    if(req.method==="POST"&&path==="/api/paper/wallets"){json(res,200,paper.create(await readJson(req)));return}
    if(req.method==="DELETE"&&path==="/api/paper/wallets"){json(res,200,paper.remove(walletId));return}
    if(req.method==="GET"&&path==="/api/paper/catalog"){json(res,200,strategyFieldCatalog);return}
    if(req.method==="GET"&&path==="/api/events"){
      res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive"});res.write(`data: ${JSON.stringify({type:"connected",at:new Date().toISOString()})}\n\n`);const client={res,userId:user.id,token,public:user===publicUser};eventClients.add(client);req.on("close",()=>eventClients.delete(client));return;
    }
    if(req.method==="PUT"&&path==="/api/paper/config"){json(res,200,{...paper.get(walletId).updateConfig(await readJson(req)),walletId});return}
    if(req.method==="POST"&&path==="/api/paper/config/reset"){json(res,200,{...paper.get(walletId).clearConfig(),walletId});return}
    if(req.method==="POST"&&path==="/api/paper/status"){const body=await readJson(req);json(res,200,{...paper.get(walletId).setStatus(body.status),walletId});return}
    if(req.method==="POST"&&path==="/api/paper/wallet"){const body=await readJson(req);json(res,200,{...paper.get(walletId).resetWallet(body.balanceUsd),walletId});return}
    if(req.method==="POST"&&path==="/api/paper/reset"){json(res,200,{...paper.get(walletId).clearSession(),walletId});return}
    if(req.method==="GET"&&path==="/api/manager"){json(res,200,manager.publicState(walletId));return}
    if(req.method==="GET"&&path==="/api/manager/stats"){json(res,200,buildPaperStats(manager.get(walletId)));return}
    if(req.method==="POST"&&path==="/api/manager/wallets"){json(res,200,manager.create(await readJson(req)));return}
    if(req.method==="DELETE"&&path==="/api/manager/wallets"){json(res,200,manager.remove(walletId));return}
    if(req.method==="POST"&&path==="/api/manager/tokens"){const body=await readJson(req),mint=String(body.mint||"").trim();if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))throw Error("Wklej poprawny adres tokena Solana.");if(!byMint.has(mint))upsertToken({mint,source:"Pump.fun",name:"Kupowany token",symbol:"TOKEN",createdAt:new Date().toISOString(),detectedAt:new Date().toISOString()});json(res,200,{...manager.get(walletId).addToken(mint),walletId,walletName:manager.wallets.find(item=>item.id===walletId)?.name,wallets:manager.list()});return}
    if(req.method==="POST"&&path==="/api/manager/tokens/sell"){const body=await readJson(req),mint=String(body.mint||"").trim();json(res,200,{...manager.get(walletId).sellToken(mint),walletId,walletName:manager.wallets.find(item=>item.id===walletId)?.name,wallets:manager.list()});return}
    if(req.method==="DELETE"&&path==="/api/manager/tokens"){json(res,200,{...manager.get(walletId).removeToken(url.searchParams.get("mint")),walletId,wallets:manager.list()});return}
    if(req.method==="PUT"&&path==="/api/manager/config"){json(res,200,{...manager.get(walletId).updateConfig(await readJson(req)),walletId,wallets:manager.list()});return}
    if(req.method==="POST"&&path==="/api/manager/config/reset"){json(res,200,{...manager.get(walletId).clearConfig(),walletId,wallets:manager.list()});return}
    if(req.method==="POST"&&path==="/api/manager/reset"){json(res,200,{...manager.get(walletId).clearSession(),walletId,wallets:manager.list()});return}
    if(req.method==="GET"&&path==="/api/copy"){json(res,200,copy.publicState(walletId));return}
    if(req.method==="GET"&&path==="/api/copy/stats"){const engine=copy.get(walletId);json(res,200,{...buildPaperStats(engine),copy:engine.copyStats()});return}
    if(req.method==="POST"&&path==="/api/copy/wallets"){const body=await readJson(req),sourceConfig=body.cloneConfigFrom?structuredClone(copy.get(body.cloneConfigFrom).state.config):null,created=copy.create({...body,cloneConfigFrom:null});if(sourceConfig)copy.get(created.walletId).updateConfig({...sourceConfig,sourceWallet:""});json(res,200,copy.publicState(created.walletId));return}
    if(req.method==="PUT"&&path==="/api/copy/wallets"){json(res,200,copy.rename(walletId,(await readJson(req)).name));return}
    if(req.method==="DELETE"&&path==="/api/copy/wallets"){json(res,200,copy.remove(walletId));return}
    if(req.method==="PUT"&&path==="/api/copy/config"){json(res,200,{...copy.get(walletId).updateConfig(await readJson(req)),walletId,walletName:copy.wallets.find(item=>item.id===walletId)?.name,wallets:copy.list()});return}
    if(req.method==="POST"&&path==="/api/copy/source"){json(res,200,{...copy.get(walletId).setSourceWallet((await readJson(req)).sourceWallet),walletId,walletName:copy.wallets.find(item=>item.id===walletId)?.name,wallets:copy.list()});return}
    if(req.method==="POST"&&path==="/api/copy/status"){json(res,200,{...copy.get(walletId).setStatus((await readJson(req)).status),walletId,walletName:copy.wallets.find(item=>item.id===walletId)?.name,wallets:copy.list()});return}
    if(req.method==="POST"&&path==="/api/copy/reset"){json(res,200,{...copy.get(walletId).clearSession(),walletId,walletName:copy.wallets.find(item=>item.id===walletId)?.name,wallets:copy.list()});return}
    if(req.method!=="GET"){json(res,405,{error:"Metoda niedozwolona."});return}
    serveFile(res,path);
  }catch(error){json(res,400,{error:error?.message||"Nie udało się wykonać operacji."});}
});
server.on("error",e=>{console.error(e.code==="EADDRINUSE"?"Port jest zajęty — serwer jest już uruchomiony.":"Błąd uruchomienia serwera.");process.exit(1)});
let shuttingDown=false;
async function shutdown(){
  if(shuttingDown)return;shuttingDown=true;
  for(const portfolio of portfolios.values())portfolio.close();
  for(const portfolio of managers.values())portfolio.close();
  for(const portfolio of copies.values())portfolio.close();
  await savePublicSnapshot(dataDir);
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(0),2000).unref?.();
}
process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
server.listen(Number(config.MEME_PILOT_PORT||config.PORT||8787),config.MEME_PILOT_HOST||(config.PORT?"0.0.0.0":"127.0.0.1"),()=>{
  console.log("Nowe coiny: http://localhost:"+server.address().port);connect();setInterval(decode,300);
  setInterval(()=>{void savePublicSnapshot(dataDir)},5000).unref?.();
  updateMarkets();setInterval(updateMarkets,5000);setInterval(pollCopyWallets,5000);setInterval(loadMetadata,250);setInterval(updateOneHolderMetric,800);
  setInterval(()=>{if(socket?.readyState===WebSocket.OPEN&&Date.now()-lastMessage>45000)socket.close()},10000);
});

