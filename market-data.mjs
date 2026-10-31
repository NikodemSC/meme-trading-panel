import { PublicKey } from "@solana/web3.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
const ZERO_KEY = "11111111111111111111111111111111";
const CREATE = Buffer.from([27,114,169,77,222,235,99,118]);
const TRADE = Buffer.from([189,219,127,211,78,230,97,238]);

// Layout: official pump-public-docs/idl/pump.json. Bounds checks reject truncated events.
export function decodePumpEvent(data) {
  const b = Buffer.from(data, "base64");
  let offset = 8;
  function take(n) { if (offset + n > b.length) throw Error("Truncated event"); const value=b.subarray(offset,offset+n);offset+=n;return value; }
  const u64 = () => Number(take(8).readBigUInt64LE());
  const key = () => new PublicKey(take(32)).toBase58();
  const str = () => { const length=take(4).readUInt32LE();if(length>4096)throw Error("Oversized string");return take(length).toString("utf8"); };
  try {
    if (b.subarray(0,8).equals(CREATE)) {
      const name=str(),symbol=str(),uri=str(),mint=key(),curve=key();
      key();key();
      const timestamp=u64(),virtualTokens=u64(),virtualSol=u64(),realTokens=u64();
      const supply=u64();
      let quoteMint=SOL_MINT,virtualQuote=virtualSol;
      if(b.length-offset>=32)key(); // token program
      if(b.length-offset>=2)take(2); // mayhem, cashback
      if(b.length-offset>=40){quoteMint=key();virtualQuote=u64();}
      if(quoteMint===ZERO_KEY)quoteMint=SOL_MINT;
      return {type:"create",name,symbol,uri,mint,curve,timestamp,supply,virtualTokens,realTokens,virtualQuote,quoteMint};
    }
    if (b.subarray(0,8).equals(TRADE)) {
      const mint=key(),solAmount=u64(),tokenAmount=u64(),isBuy=take(1)[0]===1;key();
      const timestamp=u64(),virtualSol=u64(),virtualTokens=u64();
      const realSol=u64(),realTokens=u64();
      let quoteMint=SOL_MINT,quoteAmount=solAmount,virtualQuote=virtualSol,realQuote=realSol;
      // Newer events append quote-currency data after fees and shareholders.
      if(b.length-offset>129){
        take(129);str();
        if(b.length-offset>=37){
          take(33);const count=take(4).readUInt32LE();if(count>100)throw Error("Too many shareholders");
          take(count*34);
          if(b.length-offset>=56){quoteMint=key();quoteAmount=u64();virtualQuote=u64();realQuote=u64();}
        }
      }
      if(quoteMint===ZERO_KEY)quoteMint=SOL_MINT;
      return {type:"trade",mint,timestamp,solAmount,tokenAmount,isBuy,virtualSol,virtualTokens,realSol,realTokens,quoteMint,quoteAmount,virtualQuote,realQuote};
    }
  } catch { return null; }
  return null;
}

export function pumpEvents(logs) {
  const stack=[],events=[];
  for(const line of logs||[]) {
    const invoked=line.match(/^Program (\w+) invoke/);
    if(invoked){stack.push(invoked[1]);continue;}
    if(/^Program \w+ (success|failed)/.test(line)){stack.pop();continue;}
    if(stack.at(-1)===PUMP_PROGRAM&&line.startsWith("Program data: ")) {
      const event=decodePumpEvent(line.slice(14));if(event)events.push(event);
    }
  }
  return events;
}
export function curveMarketCapSol(supply,virtualTokens,virtualSol) {
  if(!Number.isFinite(supply)||!Number.isFinite(virtualTokens)||!Number.isFinite(virtualSol)||supply<=0||virtualTokens<=0||virtualSol<=0)return null;
  return supply / virtualTokens * virtualSol / 1e9;
}

export function externalUrl(value) {
  if(typeof value!=="string"||value.length>4096)return null;
  if(value.startsWith("ipfs://"))value="https://ipfs.io/ipfs/"+value.slice(7).replace(/^ipfs\//,"");
  if(value.startsWith("ar://"))value="https://arweave.net/"+value.slice(5);
  try{
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password||url.port&&url.port!=="443"||isIP(url.hostname.replace(/[\[\]]/g,""))||url.hostname==="localhost"||!url.hostname.includes(".")||/\.(local|localhost|internal)$/.test(url.hostname))return null;
    if(url.hostname==="ipfs.io"&&url.pathname.startsWith("/ipfs/"))url.hostname="gateway.pinata.cloud";
    return url.href;
  }catch{return null;}
}
function isPublic(address) {
  if(isIP(address)===6)return /^(2|3)/i.test(address); // globally routable unicast only
  const [a,b]=address.split(".").map(Number);
  return !([0,10,127].includes(a)||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));
}
export async function readMetadata(uri) {
  let target=externalUrl(uri);if(!target)return null;
  for(let i=0;i<3;i++) {
    const addresses=await lookup(new URL(target).hostname,{all:true});
    if(!addresses.length||addresses.some(a=>!isPublic(a.address)))return null;
    const response=await fetch(target,{signal:AbortSignal.timeout(7000),redirect:"manual",headers:{Accept:"application/json"}});
    if(response.status>=300&&response.status<400){target=externalUrl(new URL(response.headers.get("location"),target).href);if(!target)return null;continue;}
    if(!response.ok)throw Error("Metadata unavailable");
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>262144)throw Error("Metadata too large");chunks.push(chunk);}
    const data=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return {image:externalUrl(data.image),name:typeof data.name==="string"?data.name.slice(0,150):null,symbol:typeof data.symbol==="string"?data.symbol.slice(0,40):null};
  }
  return null;
}

