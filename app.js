const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const list=$("#tokens"),search=$("#search"),nodes=new Map();
const minMcInput=$("#minMc"),clearFilters=$("#clearFilters"),filterError=$("#filterError");
const filterStorageKey="meme-pilot:new-coins:min-mc-usd";
let paperWalletStorageKey="meme-pilot:active-paper-wallet",managerWalletStorageKey="meme-pilot:active-manager-wallet",copyWalletStorageKey="meme-pilot:active-copy-wallet";
const usd=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2});
const compactUsd=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2});
const number=new Intl.NumberFormat("pl-PL",{maximumFractionDigits:4});
let tokens=[],feedStatus={},paper=null,minMarketCap=null,settingsHydrated=false,refreshTimer=null,activePaperTab="positions",lastHistoryId=null,lastPositionIds=new Set();
let stats=null,statsGeneration=0,statsMonth=new Date().getMonth(),statsYear=new Date().getFullYear(),selectedStatsDay=null;
let activeWalletId="main",activeManagerWalletId="main",activeCopyWalletId="main",refreshGeneration=0,currentUser=null,activePaperView="overview",manager=null,activeManagerView="overview",copy=null,copyDetailTab="positions",editingCopyWalletId=null;
function paperUrl(path){return `${path}?walletId=${encodeURIComponent(activeWalletId)}`;}
function managerUrl(path){return `${path}?walletId=${encodeURIComponent(activeManagerWalletId)}`;}
function copyUrl(path){return `${path}?walletId=${encodeURIComponent(activeCopyWalletId)}`;}
function acceptPaper(data){paper={...data,wallets:data.wallets||paper?.wallets||[]};renderPaper();}

try{
  const stored=localStorage.getItem(filterStorageKey);
  if(stored!==null&&stored.trim()!==""&&Number.isFinite(Number(stored))&&Number(stored)>=0){minMarketCap=Number(stored);minMcInput.value=String(minMarketCap);}
}catch{}

function money(value){return Number.isFinite(Number(value))?usd.format(Number(value)):"—";}
function compactMoney(value){return Number.isFinite(Number(value))?compactUsd.format(Number(value)):"—";}
function signedMoney(value){const amount=Number(value||0);return `${amount>0?"+":""}${money(amount)}`;}
function pnlClass(value){return Number(value)>0?"positive":Number(value)<0?"negative":"";}
function dateTime(value){return value?new Date(value).toLocaleString("pl-PL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—";}
function shortMint(value=""){return value.length>14?`${value.slice(0,6)}…${value.slice(-5)}`:value;}
function reasonLabel(value){return ({ENTRY_RULES:"Filtry wejścia",TAKE_PROFIT:"Take profit",PARTIAL_TAKE_PROFIT:"Częściowy take profit",STOP_LOSS:"Stop loss",TRAILING_STOP:"Trailing stop",NO_MOVEMENT:"Brak ruchu",MAX_HOLD:"Limit czasu"})[value]||value||"";}
function escapeHtml(value=""){return String(value).replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);}
function tokenAvatar(item){return item.image?`<img src="${escapeHtml(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span>${escapeHtml((item.symbol||item.name||"◈").slice(0,2).toUpperCase())}</span>`;}

function setView(name){
  const nested={stats:"stats",settings:"settings"}[name]||null;
  const valid=["scanner","paper","manager","copy"].includes(name)?name:nested?"paper":"scanner";
  $$("[data-view-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.viewPanel===valid));
  $$("[data-view]").forEach(button=>button.classList.toggle("active",button.dataset.view===valid));
  if(location.hash!==`#${valid}`)history.replaceState(null,"",`#${valid}`);
  if(nested)setPaperView(nested);
}
function setPaperView(name){
  const valid=["overview","stats","settings"].includes(name)?name:"overview";
  activePaperView=valid;
  $$("[data-paper-subview]").forEach(panel=>panel.classList.toggle("active",panel.dataset.paperSubview===valid));
  $$("[data-paper-view]").forEach(button=>button.classList.toggle("active",button.dataset.paperView===valid));
  if(valid==="stats"&&currentUser)refreshStats();
}
function setManagerView(name){
  const valid=["overview","stats","settings"].includes(name)?name:"overview";
  activeManagerView=valid;
  $$('[data-manager-subview]').forEach(panel=>panel.classList.toggle('active',panel.dataset.managerSubview===valid));
  $$('[data-manager-view]').forEach(button=>button.classList.toggle('active',button.dataset.managerView===valid));
  if(valid==="stats"&&currentUser)refreshManagerStats();
}
function initializePaperSubviews(){
  const paperPanel=$("[data-view-panel='paper']");
  for(const name of ["stats","settings"]){
    const panel=$(`[data-view-panel='${name}']`);if(!panel)continue;
    panel.classList.remove("view","active");panel.classList.add("paper-subview");panel.dataset.paperSubview=name;panel.removeAttribute("data-view-panel");paperPanel.append(panel);
  }
}
initializePaperSubviews();
$$('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
$$('[data-paper-view]').forEach(button=>button.addEventListener('click',()=>setPaperView(button.dataset.paperView)));
$$('[data-manager-view]').forEach(button=>button.addEventListener('click',()=>setManagerView(button.dataset.managerView)));
setView(location.hash.slice(1));window.addEventListener("hashchange",()=>setView(location.hash.slice(1)));

function updateCard(node,token){
  node.querySelector("strong").textContent=token.name||token.symbol||"Nowy token";
  node.querySelector(".symbol").textContent=token.symbol||"";
  node.querySelector(".badge").textContent=token.source||token.standard||"Solana";
  const icon=node.querySelector(".icon");
  if(token.image&&icon.dataset.image!==token.image){
    icon.dataset.image=token.image;const image=document.createElement("img");image.src=token.image;image.alt="";image.loading="lazy";image.referrerPolicy="no-referrer";
    image.onerror=()=>{icon.textContent=(token.symbol||token.name||"◈").slice(0,2).toUpperCase()};icon.replaceChildren(image);
  }
  const mc=node.querySelector(".mc-value"),details=node.querySelector(".mc-details"),previous=Number(node.dataset.mc),value=token.marketCapUsd;
  mc.textContent=Number.isFinite(value)?compactUsd.format(value):"—";mc.title=Number.isFinite(value)?usd.format(value):"Brak dostępnej wyceny";
  if(Number.isFinite(value)&&Number.isFinite(previous)&&node.dataset.mc&&previous!==value){mc.classList.remove("tick-up","tick-down");void mc.offsetWidth;mc.classList.add(value>previous?"tick-up":"tick-down");}
  node.dataset.mc=Number.isFinite(value)?String(value):"";
  const metricParts=[];
  if(Number.isFinite(token.marketCapSol))metricParts.push(`${token.marketCapSol.toLocaleString("pl-PL",{maximumFractionDigits:2})} SOL`);
  if(Number.isFinite(token.volume5mUsd))metricParts.push(`Vol 5m ${compactMoney(token.volume5mUsd)}`);
  if(Number.isFinite(token.transactions5m))metricParts.push(`${token.transactions5m} tx`);
  if(Number.isFinite(token.buys5m)&&Number.isFinite(token.sells5m))metricParts.push(`B ${token.buys5m} / S ${token.sells5m}`);
  if(Number.isFinite(token.bondingCurveProgressPercent))metricParts.push(`Curve ${token.bondingCurveProgressPercent.toFixed(0)}%`);
  details.textContent=metricParts.join(" · ")||token.mcSource||"Brak wyceny";
  const label=node.querySelector(".mc-state"),rateStale=token.mcSource?.startsWith("Pump.fun")&&(!token.usdRateAt||Date.now()-token.usdRateAt>60000),disconnected=token.mcSource?.startsWith("Pump.fun")&&!feedStatus.connected,marketStale=token.mcSource==="DEX Screener"&&(Date.now()-Date.parse(token.mcUpdatedAt)>120000||feedStatus.marketError);
  label.textContent=token.mcUpdatedAt?(rateStale||disconnected||marketStale?"Ostatni odczyt":token.mcSource?.startsWith("Pump.fun")?"● On-chain":"↻ Rynek"):"";
  label.classList.toggle("stale",Boolean(rateStale||disconnected||marketStale));label.title=token.mcUpdatedAt?`${token.mcSource} · ${new Date(token.mcUpdatedAt).toLocaleTimeString("pl-PL")}`:"";
}

function renderScanner(){
  const query=search.value.trim().toLowerCase(),pumpTokens=tokens.filter(token=>token.source==="Pump.fun");
  const visible=pumpTokens.filter(token=>(minMarketCap===null||(Number.isFinite(token.marketCapUsd)&&token.marketCapUsd>=minMarketCap))&&[token.mint,token.name,token.symbol].some(value=>value?.toLowerCase().includes(query))),wanted=new Set(visible.map(token=>token.mint));
  $("#count").textContent=visible.length.toLocaleString("pl-PL");$("#countLabel").textContent=`widocznych / ${pumpTokens.length.toLocaleString("pl-PL")} Pump.fun`;
  clearFilters.disabled=minMarketCap===null&&minMcInput.value===""&&!minMcInput.validity.badInput;
  for(const[mint,node]of nodes)if(!wanted.has(mint)){node.remove();nodes.delete(mint);}
  list.querySelector(".empty")?.remove();
  for(let index=0;index<visible.length;index++){
    const token=visible[index];let node=nodes.get(token.mint);
    if(!node){
      node=document.createElement("article");node.className="token";
      node.innerHTML='<div class="asset"><span class="icon">◈</span><div class="details"><div class="token-title"><strong></strong><span class="symbol"></span></div><button class="address" title="Kopiuj adres"></button></div></div><div class="market-cap"><b class="mc-value">—</b><small class="mc-details"></small><small class="mc-state"></small></div><span class="badge"></span><span class="time"></span><a class="tx" target="_blank" rel="noopener noreferrer">Solscan ↗</a>';
      const button=node.querySelector("button");button.textContent=`${token.mint} ⧉`;button.onclick=async()=>{try{await navigator.clipboard.writeText(token.mint);button.textContent="Skopiowano ✓";setTimeout(()=>button.textContent=`${token.mint} ⧉`,1500);}catch{button.textContent=token.mint;}};
      node.querySelector(".time").textContent=token.createdAt?new Date(token.createdAt).toLocaleTimeString("pl-PL"):"—";node.querySelector(".tx").href=`https://solscan.io/tx/${encodeURIComponent(token.signature)}`;nodes.set(token.mint,node);
    }
    updateCard(node,token);if(list.children[index]!==node)list.insertBefore(node,list.children[index]||null);
  }
  if(!visible.length){const empty=document.createElement("div");empty.className="empty";empty.textContent=query||minMarketCap!==null?"Brak tokenów spełniających filtry. Skanowanie trwa.":"Oczekiwanie na nowe tokeny Pump.fun…";list.append(empty);}
}

function renderFeedStatus(){
  const connection=$("#connection");connection.textContent=feedStatus.connected?"● LIVE":feedStatus.message||"Brak połączenia";connection.classList.toggle("live",Boolean(feedStatus.connected));
  $("#queue").textContent=feedStatus.pending?`Do odczytania: ${feedStatus.pending}`:"";
  $("#notice").textContent=[feedStatus.publicRpc?"Publiczne RPC — możliwe opóźnienia i braki.":"",feedStatus.rpcError?"Odczyt transakcji chwilowo niedostępny. Ponawiam.":"",feedStatus.marketError?"Wyceny rynku chwilowo niedostępne. Zachowano ostatnie dane.":"",feedStatus.missed?`Nie odczytano zdarzeń: ${feedStatus.missed}`:""].filter(Boolean).join(" ");
}

function renderPaper(){
  if(!paper)return;const wallet=paper.wallet,status=$("#botStatus"),scrolls={positions:$("#positionsPanel").scrollTop,history:$("#historyPanel").scrollTop,logs:$("#logsPanel").scrollTop};
  const wallets=paper.wallets||[];
  for(const select of [$("#paperWalletSelect")]){
    if(select.options.length!==wallets.length||wallets.some((item,index)=>select.options[index]?.value!==item.id||select.options[index]?.textContent!==item.name)){
      select.replaceChildren(...wallets.map(item=>{const option=document.createElement("option");option.value=item.id;option.textContent=item.name;return option;}));
    }
    select.value=paper.walletId||activeWalletId;
  }
  const deleteWallet=$("#deletePaperWallet");deleteWallet.disabled=wallets.length<=1;deleteWallet.title=wallets.length<=1?"Ostatniego portfela nie można usunąć.":"Usuń wybrany portfel wraz z jego danymi.";
  $("#settingsWalletName").textContent=paper.walletName||wallets.find(item=>item.id===activeWalletId)?.name||"Paper";
  $("#statsWalletName").textContent=paper.walletName||wallets.find(item=>item.id===activeWalletId)?.name||"Paper";
  status.className=`bot-status ${paper.status}`;status.querySelector("b").textContent=paper.status==="running"?"Running":paper.status==="paused"?"Paused":"Stopped";
  $("#paperEquity").textContent=money(wallet.equityUsd);$("#paperTotalPnl").textContent=signedMoney(wallet.totalPnlUsd);$("#paperTotalPnl").className=pnlClass(wallet.totalPnlUsd);
  $("#paperCash").textContent=money(wallet.cashUsd);$("#paperCashSol").textContent=feedStatus.solPriceUsd?`${number.format(wallet.cashUsd/feedStatus.solPriceUsd)} SOL`:"— SOL";
  $("#paperPositionsValue").textContent=money(wallet.openValueUsd);$("#paperPositionCount").textContent=`${paper.positions.length} ${paper.positions.length===1?"pozycja":"pozycji"}`;
  for(const [id,value] of [["#paperRealized",wallet.realizedPnlUsd],["#paperUnrealized",wallet.unrealizedPnlUsd]]){const element=$(id);element.textContent=signedMoney(value);element.className=pnlClass(value);}
  $("#positionBadge").textContent=paper.positions.length;$("#historyBadge").textContent=paper.history.length;
  $("#positionsPanel").innerHTML=paper.positions.length?paper.positions.map(position=>`<article class="trade-row position-row"><div class="trade-asset"><span class="mini-avatar">${tokenAvatar(position)}</span><div><strong>${escapeHtml(position.name||position.symbol||"Token")}</strong><button class="copy-mint" data-mint="${escapeHtml(position.mint)}">${escapeHtml(shortMint(position.mint))} ⧉</button></div></div><div><span>Wartość</span><b>${money(position.currentValueUsd)}</b></div><div><span>Wejście / teraz</span><b>${compactMoney(position.entryMarketCapUsd)} → ${compactMoney(position.currentMarketCapUsd)}</b></div><div><span>PnL</span><b class="${pnlClass(position.unrealizedPnlUsd)}">${signedMoney(position.unrealizedPnlUsd)} · ${Number(position.pnlPercent||0).toFixed(2)}%</b></div><div><span>Otwarto</span><b>${dateTime(position.openedAt)}</b></div></article>`).join(""):`<div class="empty compact">Brak otwartych pozycji.</div>`;
  $("#historyPanel").innerHTML=paper.history.length?paper.history.map(trade=>{const fees=Number(trade.networkFeeUsd||0)+Number(trade.platformFeeUsd||0)+Number(trade.slippageUsd||0)+Number(trade.priceImpactUsd||0),marketCaps=trade.signalMarketCapUsd?`${compactMoney(trade.signalMarketCapUsd)} → ${compactMoney(trade.marketCapUsd)}`:compactMoney(trade.marketCapUsd);return `<article class="trade-row history-row"><span class="side ${trade.side.toLowerCase()}">${trade.partial?`SELL ${number.format(trade.soldPercent)}%`:trade.side}</span><div class="trade-asset"><span class="mini-avatar">${tokenAvatar(trade)}</span><div><strong>${escapeHtml(trade.name||trade.symbol||"Token")}</strong><button class="copy-mint" data-mint="${escapeHtml(trade.mint)}">${escapeHtml(shortMint(trade.mint))} ⧉</button><small class="trade-reason">${escapeHtml(reasonLabel(trade.reason))}</small></div></div><div><span>Kwota</span><b>${money(trade.grossUsd)}</b></div><div><span>Fee + koszty</span><b>${money(fees)}</b></div><div><span>MC sygnał → zakup</span><b>${marketCaps}</b></div><div><span>${trade.side==="BUY"?"Wartość tokenów":"Wpływ"}</span><b>${money(trade.netAssetUsd)}</b></div><div><span>Czas</span><b>${dateTime(trade.at)}</b></div></article>`;}).join(""):`<div class="empty compact">Historia jest pusta.</div>`;
  $("#logsPanel").innerHTML=paper.logs.length?paper.logs.map(log=>`<article class="log-row"><span class="log-type ${log.type.toLowerCase()}">${escapeHtml(log.type)}</span><p>${escapeHtml(log.message)}</p><time>${dateTime(log.at)}</time></article>`).join(""):`<div class="empty compact">Brak zdarzeń.</div>`;
  const currentPositionIds=new Set(paper.positions.map(position=>position.id));
  paper.positions.forEach((position,index)=>{if(lastPositionIds.size&&!lastPositionIds.has(position.id))$("#positionsPanel").children[index]?.classList.add("new-row");});
  if(lastHistoryId&&paper.history[0]?.id!==lastHistoryId)$("#historyPanel").firstElementChild?.classList.add("new-row");
  lastPositionIds=currentPositionIds;lastHistoryId=paper.history[0]?.id||lastHistoryId;
  $("#positionsPanel").scrollTop=scrolls.positions;$("#historyPanel").scrollTop=scrolls.history;$("#logsPanel").scrollTop=scrolls.logs;
  $$(".copy-mint").forEach(button=>button.onclick=async()=>{await navigator.clipboard.writeText(button.dataset.mint);const old=button.textContent;button.textContent="Skopiowano ✓";setTimeout(()=>button.textContent=old,1200);});
  if(!settingsHydrated)hydrateSettings();updateWalletConversion();
}

function hydrateSettings(){
  if(!paper)return;const form=$("#strategyForm");
  for(const [key,value] of Object.entries(paper.config)){const field=form.elements.namedItem(key);if(!field)continue;if(field.type==="checkbox")field.checked=Boolean(value);else field.value=value??"";}
  $$(".time-unit").forEach(select=>{const field=form.elements.namedItem(select.dataset.timeUnitFor),seconds=Number(field?.value);const unit=Number.isFinite(seconds)&&seconds>=3600&&seconds%3600===0?"hours":"seconds";select.value=unit;select.dataset.previousUnit=unit;if(Number.isFinite(seconds)&&field)field.value=String(seconds/(unit==="hours"?3600:1));});
  settingsHydrated=true;
}
function timeUnitFactor(unit){return unit==="hours"?3600:1;}
function timeUnitFor(key){return $$(".time-unit").find(select=>select.dataset.timeUnitFor===key);}
function updateWalletConversion(){
  const amount=Number($("#walletBalance").value),currency=$("#walletCurrency").value,price=Number(feedStatus.solPriceUsd);
  $("#walletConversion").textContent=!Number.isFinite(amount)||amount<=0?"—":currency==="SOL"?(price?`≈ ${money(amount*price)}`:"Brak aktualnego kursu SOL"):(price?`≈ ${number.format(amount/price)} SOL`:"Brak aktualnego kursu SOL");
}
function showMessage(selector,text,error=false){const node=$(selector);node.textContent=text;node.classList.toggle("error",error);clearTimeout(node._timer);node._timer=setTimeout(()=>node.textContent="",4000);}
async function request(path,options={}){const response=await MemeConnection.fetch(path,{...options,headers:{"Content-Type":"application/json","X-Meme-Pilot-Request":"1",...(options.headers||{})}});if(response.status===401){MemeConnection.login();throw Error("Zaloguj się ponownie.")}const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"Operacja nie powiodła się.");return data;}

function statsDateKey(year,month,day){return String(year)+"-"+String(month+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");}
function todayStatsKey(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Warsaw",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(part=>[part.type,part.value]));
  return parts.year+"-"+parts.month+"-"+parts.day;
}
function renderStatsCalendar(){
  if(!stats)return;
  const days=stats.days||{},today=todayStatsKey(),first=new Date(statsYear,statsMonth,1),firstWeekday=(first.getDay()+6)%7,count=new Date(statsYear,statsMonth+1,0).getDate();
  $("#statsMonthLabel").textContent=first.toLocaleDateString("pl-PL",{month:"long",year:"numeric"});
  $("#nextStatsMonth").disabled=statsYear>Number(today.slice(0,4))||(statsYear===Number(today.slice(0,4))&&statsMonth>=Number(today.slice(5,7))-1);
  const cells=[];
  for(let i=0;i<firstWeekday;i++)cells.push('<span class="calendar-blank"></span>');
  for(let day=1;day<=count;day++){
    const key=statsDateKey(statsYear,statsMonth,day),entry=days[key],pnl=Number(entry?.realizedPnlUsd||0),hasTrades=Boolean(entry?.buyCount||entry?.sellCount);
    const classes=["calendar-day",pnl>0?"positive":pnl<0?"negative":"",key===today?"today":"",key===selectedStatsDay?"active":""].filter(Boolean).join(" ");
    const amount=entry?.sellCount?compactMoney(pnl):"—";
    cells.push('<button type="button" class="'+classes+'" data-stats-day="'+key+'" aria-label="'+key+', wynik '+money(pnl)+'"><span>'+day+'</span><b>'+amount+'</b><small>'+(hasTrades?Number(entry.buyCount||0)+Number(entry.sellCount||0)+" trans.":"")+'</small></button>');
  }
  $("#statsCalendar").innerHTML=cells.join("");
  $$(".calendar-day").forEach(button=>button.addEventListener("click",()=>{selectedStatsDay=button.dataset.statsDay;renderStatsCalendar();}));
  const currentMonth=statsYear===Number(today.slice(0,4))&&statsMonth===Number(today.slice(5,7))-1;
  const selected=selectedStatsDay||(currentMonth?today:statsDateKey(statsYear,statsMonth,1)),entry=days[selected];
  $("#statsDayDetail").innerHTML=entry?'<strong>'+selected+'</strong> · wynik <b class="'+pnlClass(entry.realizedPnlUsd)+'">'+signedMoney(entry.realizedPnlUsd)+'</b> · kupna '+Number(entry.buyCount||0)+' · sprzedaże '+Number(entry.sellCount||0):'<strong>'+selected+'</strong> · brak zapisanych transakcji.';
}

function renderStatsChart(){
  if(!stats)return;
  const now=todayStatsKey(),end=new Date(now+"T12:00:00Z"),keys=[];
  for(let i=29;i>=0;i--){const date=new Date(end);date.setUTCDate(date.getUTCDate()-i);keys.push(date.toISOString().slice(0,10));}
  let total=0;
  const values=[0,...keys.map(key=>{total+=Number(stats.days?.[key]?.realizedPnlUsd||0);return total;})];
  const min=Math.min(0,...values),max=Math.max(0,...values),span=Math.max(1,max-min),pad=span*.12,lower=min-pad,upper=max+pad;
  const x=index=>20+index*560/(values.length-1),y=value=>205-(value-lower)/(upper-lower)*180;
  const points=values.map((value,index)=>x(index).toFixed(1)+","+y(value).toFixed(1));
  const line="M"+points.join(" L"),baseline=y(0).toFixed(1),area=line+" L"+x(values.length-1).toFixed(1)+","+baseline+" L20,"+baseline+" Z";
  const color=total>0?"#67dda4":total<0?"#ff8098":"#bda2ff";
  $("#chartResult").textContent=signedMoney(total);$("#chartResult").className=pnlClass(total);
  $("#chartStart").textContent=keys[0].slice(5).replace("-",".");$("#chartEnd").textContent=keys.at(-1).slice(5).replace("-",".");
  $("#statsChart").innerHTML='<defs><linearGradient id="statsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+color+'" stop-opacity=".28"/><stop offset="100%" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs><line class="chart-grid" x1="20" y1="25" x2="580" y2="25"/><line class="chart-grid" x1="20" y1="115" x2="580" y2="115"/><line class="chart-grid" x1="20" y1="205" x2="580" y2="205"/><line class="chart-zero" x1="20" y1="'+baseline+'" x2="580" y2="'+baseline+'"/><path d="'+area+'" fill="url(#statsFill)"/><path class="chart-line" style="stroke:'+color+'" d="'+line+'"/><circle class="chart-dot" style="fill:'+color+'" cx="'+x(values.length-1).toFixed(1)+'" cy="'+y(total).toFixed(1)+'" r="5"/>';
}

function renderStats(){
  if(!stats)return;
  for(const [selector,value] of [["#statsTotalPnl",stats.wallet.totalPnlUsd],["#statsRealized",stats.wallet.realizedPnlUsd],["#statsUnrealized",stats.wallet.unrealizedPnlUsd]]){const node=$(selector);node.textContent=signedMoney(value);node.className=pnlClass(value);}
  $("#statsWinRate").textContent=stats.totals.winRatePercent===null?"—":number.format(stats.totals.winRatePercent)+"%";
  $("#statsWinLoss").textContent="Zamknięte: "+stats.totals.closedWins+" zyskownych · "+stats.totals.closedLosses+" stratnych";
  $("#statsEntriesCount").textContent=stats.totals.entries+" wejść";
  $("#statsBuckets").innerHTML=stats.buckets.map(bucket=>{
    const profitRate=bucket.count?Math.round(bucket.profitable/bucket.count*100):0,lossRate=bucket.count?Math.round(bucket.losing/bucket.count*100):0;
    return '<div class="stats-bucket"><strong>'+escapeHtml(bucket.label)+'</strong><span class="bucket-share">'+number.format(bucket.sharePercent)+'%</span><span class="bucket-track"><i style="width:'+Math.max(0,Math.min(100,bucket.sharePercent))+'%"></i></span><span class="bucket-count">'+bucket.count+' wejść · '+bucket.open+' otw.</span><span class="bucket-outcome"><em>↑ '+bucket.profitable+' ('+profitRate+'%)</em> · <i>↓ '+bucket.losing+' ('+lossRate+'%)</i></span></div>';
  }).join("");
  renderStatsCalendar();renderStatsChart();
}

async function refreshStats(){
  const generation=++statsGeneration,walletId=activeWalletId;
  try{
    const data=await request("/api/paper/stats?walletId="+encodeURIComponent(walletId));
    if(generation!==statsGeneration||walletId!==activeWalletId)return;
    stats=data;$("#statsMessage").textContent="";renderStats();
  }catch(error){if(generation===statsGeneration)showMessage("#statsMessage",error.message,true);}
}

function renderManager(){
  if(!manager)return;
  const wallet=manager.wallet||{};
  const managerWallets=manager.wallets||[],managerSelect=$("#managerWalletSelect");managerSelect.innerHTML=managerWallets.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");managerSelect.value=manager.walletId||activeManagerWalletId;$("#deleteManagerWallet").disabled=managerWallets.length<=1;
  for(const [id,value] of [["#managerEquity",wallet.equityUsd],["#managerCash",wallet.cashUsd],["#managerOpenValue",wallet.openValueUsd]])$(id).textContent=money(value);
  $("#managerTotalPnl").textContent=signedMoney(wallet.totalPnlUsd);$("#managerTotalPnl").className=pnlClass(wallet.totalPnlUsd);
  $("#managerPositionCount").textContent=`${manager.positions.length} ${manager.positions.length===1?"pozycja":"pozycji"}`;
  $("#managerTrackedCount").textContent=manager.positions.length;$("#managerHistoryBadge").textContent=`Historia (${manager.history.length})`;
  const rows=manager.positions.map(position=>`<article class="trade-row position-row"><div class="trade-asset"><span class="mini-avatar">${tokenAvatar(position)}</span><div><strong>${escapeHtml(position.name||position.symbol||"Token")}</strong><button class="copy-mint" data-mint="${escapeHtml(position.mint)}">${escapeHtml(shortMint(position.mint))} ⧉</button></div></div><div><span>Wartość</span><b>${money(position.currentValueUsd)}</b></div><div><span>Wejście / teraz</span><b>${compactMoney(position.entryMarketCapUsd)} → ${compactMoney(position.currentMarketCapUsd)}</b></div><div><span>PnL</span><b class="${pnlClass(position.unrealizedPnlUsd)}">${signedMoney(position.unrealizedPnlUsd)} · ${Number(position.pnlPercent||0).toFixed(2)}%</b></div><div><span>Akcja</span><button class="button danger-soft manager-remove" data-mint="${escapeHtml(position.mint)}" type="button">Usuń</button></div></article>`).join("");
  $("#managerPositions").innerHTML=rows||'<div class="empty compact">Nie obserwujesz jeszcze żadnego tokena.</div>';
  $$(".manager-remove").forEach(button=>button.addEventListener("click",async()=>{try{manager=await request(`${managerUrl("/api/manager/tokens")}&mint=${encodeURIComponent(button.dataset.mint)}`,{method:"DELETE"});renderManager();showMessage("#managerMessage","Token usunięty z Menadżera.");}catch(error){showMessage("#managerMessage",error.message,true);}}));
  const managerEntries=manager.history.filter(trade=>trade.side==="BUY").slice(0,30);
  $("#managerHistory").innerHTML=managerEntries.length?managerEntries.map(buy=>{const sells=manager.history.filter(trade=>trade.side==="SELL"&&trade.positionId===buy.positionId),sold=sells.reduce((sum,item)=>sum+Number(item.netAssetUsd||0),0),pnl=sells.reduce((sum,item)=>sum+Number(item.realizedPnlUsd||0),0),closed=sells.some(item=>!item.partial||Number(item.soldPercent)>=100);return `<article class="trade-row history-row manager-history-row"><span class="side ${closed?"sell":"buy"}">${closed?"CLOSED":"OPEN"}</span><div class="trade-asset"><span class="mini-avatar">${tokenAvatar(buy)}</span><div><strong>${escapeHtml(buy.name||buy.symbol||"Token")}</strong><button class="copy-mint" data-mint="${escapeHtml(buy.mint)}">${escapeHtml(shortMint(buy.mint))} ⧉</button></div></div><div><span>Kupiono za</span><b>${money(buy.grossUsd)}</b><small>MC ${compactMoney(buy.marketCapUsd)}</small></div><div><span>Sprzedano za</span><b>${sells.length?money(sold):"—"}</b><small>${sells.length?`${sells.length} sprzedaż(e)`:"Pozycja otwarta"}</small></div><div><span>Finalny wynik</span><b class="${pnlClass(pnl)}">${sells.length?signedMoney(pnl):"—"}</b><small>${sells[0]?escapeHtml(reasonLabel(sells[0].reason)):dateTime(buy.at)}</small></div></article>`;}).join(""):'<div class="empty compact">Historia jest pusta.</div>';
  const form=$("#managerSettingsForm");if(form&&!form.dataset.hydrated){for(const element of form.elements){if(element.name&&manager.config[element.name]!==undefined)element.value=manager.config[element.name]??"";}form.dataset.hydrated="1";}
}
async function refreshManagerStats(){
  try{const data=await request(managerUrl("/api/manager/stats"));$("#managerStatsTotalPnl").textContent=signedMoney(data.wallet.totalPnlUsd);$("#managerStatsRealized").textContent=signedMoney(data.wallet.realizedPnlUsd);$("#managerStatsEntries").textContent=data.totals.entries;$("#managerStatsWinRate").textContent=data.totals.winRatePercent===null?"—":`${number.format(data.totals.winRatePercent)}%`;$("#managerStatsMessage").textContent="";}catch(error){showMessage("#managerStatsMessage",error.message,true);}
}
function renderCopyLegacyUnused(){
  if(!copy)return;
  const wallet=copy.wallet||{};
  for(const [id,value] of [["#copyEquity",wallet.equityUsd],["#copyCash",wallet.cashUsd],["#copyOpenValue",wallet.openValueUsd]])$(id).textContent=money(value);
  $("#copyTotalPnl").textContent=signedMoney(wallet.totalPnlUsd);$("#copyTotalPnl").className=pnlClass(wallet.totalPnlUsd);
  $("#copyPositionCount").textContent=`${copy.positions.length} ${copy.positions.length===1?"pozycja":"pozycji"}`;$("#copySourceShort").textContent=copy.sourceWallet?shortMint(copy.sourceWallet):"Nie ustawiono";$("#copyCopyStatus").textContent=copy.sourceWallet?(copy.status==="running"?"Aktywne kopiowanie":"Wstrzymane"):"Oczekiwanie na portfel";
  const source=$("#copySourceWallet");if(document.activeElement!==source)source.value=copy.sourceWallet||"";
  $("#copyHistoryBadge").textContent=`Historia (${copy.history.length})`;
  $("#copyPositions").innerHTML=copy.positions.length?copy.positions.map(position=>{const diff=Number(position.sourceMarketCapUsd)>0?((Number(position.entryMarketCapUsd)/Number(position.sourceMarketCapUsd)-1)*100):null;return `<article class="trade-row position-row"><div class="trade-asset"><span class="mini-avatar">${tokenAvatar(position)}</span><div><strong>${escapeHtml(position.name||position.symbol||"Token")}</strong><button class="copy-mint" data-mint="${escapeHtml(position.mint)}">${escapeHtml(shortMint(position.mint))} ⧉</button></div></div><div><span>Wartość</span><b>${money(position.currentValueUsd)}</b></div><div><span>MC źródła → Copy</span><b>${compactMoney(position.sourceMarketCapUsd)} → ${compactMoney(position.entryMarketCapUsd)}</b></div><div><span>Różnica</span><b class="${pnlClass(-Number(diff||0))}">${diff===null?"—":`${diff>=0?"+":""}${diff.toFixed(2)}%`}</b></div><div><span>PnL</span><b class="${pnlClass(position.unrealizedPnlUsd)}">${signedMoney(position.unrealizedPnlUsd)}</b></div></article>`;}).join(""):'<div class="empty compact">Brak otwartych pozycji Copy.</div>';
  $("#copyHistory").innerHTML=copy.history.length?copy.history.slice(0,30).map(trade=>`<article class="trade-row history-row"><span class="side ${trade.side.toLowerCase()}">${trade.side}</span><div class="trade-asset"><div><strong>${escapeHtml(trade.symbol||shortMint(trade.mint))}</strong><small>${escapeHtml(reasonLabel(trade.reason))}</small></div></div><div><span>MC źródła → Copy</span><b>${compactMoney(trade.sourceMarketCapUsd)} → ${compactMoney(trade.marketCapUsd)}</b></div><div><span>Kwota</span><b>${money(trade.grossUsd)}</b></div><div><span>Delay</span><b>${Math.round(trade.executionDelayMs||0)} ms</b></div><div><span>Czas</span><b>${dateTime(trade.at)}</b></div></article>`).join(""):'<div class="empty compact">Historia jest pusta.</div>';
  const form=$("#copySettingsForm");if(form&&!form.dataset.hydrated){for(const element of form.elements){if(element.name&&copy.config[element.name]!==undefined){if(element.type==="checkbox")element.checked=Boolean(copy.config[element.name]);else element.value=copy.config[element.name]??"";}}form.dataset.hydrated="1";}
  $("#copyAutoSellSettings").classList.toggle("copy-auto-sell-on",Boolean($("#copyAutoSell").checked));
}
function renderCopyCalendar(data){
  const today=todayStatsKey(),first=new Date(copyStatsYear,copyStatsMonth,1),firstWeekday=(first.getDay()+6)%7,count=new Date(copyStatsYear,copyStatsMonth+1,0).getDate(),days=data?.days||{};
  $("#copyMonthLabel").textContent=first.toLocaleDateString("pl-PL",{month:"long",year:"numeric"});let cells=Array.from({length:firstWeekday},()=>'<span class="calendar-blank"></span>');
  for(let day=1;day<=count;day++){const key=`${copyStatsYear}-${String(copyStatsMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`,entry=days[key],pnl=Number(entry?.realizedPnlUsd||0);cells.push(`<button class="calendar-day ${pnl>0?"positive":pnl<0?"negative":""} ${key===today?"today":""}" type="button" data-copy-day="${key}"><b>${day}</b><small>${entry?money(pnl):""}</small></button>`);}
  $("#copyCalendar").innerHTML=cells.join("");$$("[data-copy-day]").forEach(button=>button.addEventListener("click",()=>{$("#copyDayDetail").innerHTML=`<strong>${button.dataset.copyDay}</strong> · wynik ${button.querySelector("small").textContent||"brak transakcji"}`;}));
}
async function refreshCopyStats(){
  try{const data=await request("/api/copy/stats");$("#copyStatsTotalPnl").textContent=signedMoney(data.wallet.totalPnlUsd);$("#copyStatsEntries").textContent=data.totals.entries;$("#copyStatsWinRate").textContent=data.totals.winRatePercent===null?"—":`${number.format(data.totals.winRatePercent)}%`;const diff=data.copy?.averageMarketCapDifferencePercent;$("#copyAvgMcDiff").textContent=diff===null||diff===undefined?"—":`${diff>=0?"+":""}${number.format(diff)}%`;renderCopyCalendar(data);}catch(error){showMessage("#copyStatsMessage",error.message,true);}
}

function renderCopy(){
  if(!copy)return;
  const wallets=copy.wallets||[];
  $("#copyConfigCount").textContent=wallets.length;
  $("#emptyCopyConfigs").hidden=wallets.length>0;
  $("#copyConfigList").innerHTML=wallets.map(item=>`<button class="old-copy-row ${item.id===copy.walletId?"selected":""}" data-copy-wallet="${escapeHtml(item.id)}" type="button"><span class="old-copy-row-icon">◈</span><span><strong>${escapeHtml(item.name)}</strong><small>${item.sourceWallet?escapeHtml(shortMint(item.sourceWallet)):"Brak portfela źródłowego"}</small></span><b>${money(item.equityUsd)}</b></button>`).join("");
  const wallet=copy.wallet||{},positions=copy.positions||[],history=copy.history||[],isRunning=copy.status==="running";
  const positionsMarkup=positions.length?positions.map(position=>`<article class="old-copy-card"><div class="old-copy-card-head"><div class="trade-asset"><span class="mini-avatar">${tokenAvatar(position)}</span><div><strong>${escapeHtml(position.name||position.symbol||"Token")}</strong><button class="copy-mint" data-mint="${escapeHtml(position.mint)}">${escapeHtml(shortMint(position.mint))} ⧉</button></div></div><span class="side buy">OTWARTA</span></div><div class="old-copy-card-values"><span>Włożone<strong>${money(position.entryDebitedUsd||position.grossEntryUsd)}</strong></span><span>Wartość<strong>${money(position.currentValueUsd)}</strong></span><span>PnL<strong class="${pnlClass(position.unrealizedPnlUsd)}">${signedMoney(position.unrealizedPnlUsd)}</strong></span></div></article>`).join(""):'<div class="old-copy-no-data">Brak otwartych pozycji.</div>';
  const historyMarkup=history.length?history.slice(0,30).map(trade=>{const fees=Number(trade.networkFeeUsd||0)+Number(trade.platformFeeUsd||0)+Number(trade.slippageUsd||0)+Number(trade.priceImpactUsd||0);return `<article class="old-copy-card"><div class="old-copy-card-head"><div><span class="side ${trade.side.toLowerCase()}">${trade.side==="BUY"?"KUPNO":"SPRZEDAŻ"}</span><strong>${escapeHtml(trade.name||trade.symbol||shortMint(trade.mint))}</strong></div><time>${dateTime(trade.at)}</time></div><button class="copy-mint" data-mint="${escapeHtml(trade.mint)}">CA · ${escapeHtml(shortMint(trade.mint))} ⧉</button><div class="old-copy-card-values"><span>Kwota<strong>${money(trade.grossUsd)}</strong></span><span>Fee<strong>${money(fees)}</strong></span><span>MC<strong>${compactMoney(trade.marketCapUsd)}</strong></span></div></article>`;}).join(""):'<div class="old-copy-no-data">Historia zacznie się od następnej transakcji kopiowanego portfela.</div>';
  $("#copyDetail").innerHTML=`<div class="old-copy-detail-head"><div class="old-copy-actions"><button data-copy-action="edit" type="button">Edytuj</button><button data-copy-action="reset" type="button">Reset</button><button class="danger" data-copy-action="delete" type="button">Usuń</button></div><button class="old-copy-toggle ${isRunning?"running":""}" data-copy-action="toggle" type="button">${isRunning?"Pauza":"Wznów"}</button></div><div class="old-copy-detail-title"><span class="old-copy-row-icon">◈</span><div><small>COPY TRADING · PAPER</small><h2>${escapeHtml(copy.walletName||"Copy")}</h2><button class="copy-mint" data-mint="${escapeHtml(copy.sourceWallet||"")}">${copy.sourceWallet?`Kopiuje: ${escapeHtml(shortMint(copy.sourceWallet))} ⧉`:"Nie ustawiono portfela źródłowego"}</button></div></div><p class="old-copy-settings-line">Skala ${number.format(copy.scalePercent||100)}% · delay ${Math.round(copy.config?.executionDelayMs||0)} ms · fee ${number.format(copy.config?.platformFeePercent||0)}% + ${money(copy.config?.networkFeeUsd||0)} · poślizg ${number.format(copy.config?.slippagePercent||0)}%</p><div class="old-copy-performance"><span>Kapitał startowy<strong>${money(wallet.initialBalanceUsd)}</strong></span><span>Łącznie teraz<strong>${money(wallet.equityUsd)}</strong></span><span>W pozycjach<strong>${money(wallet.openValueUsd)}</strong></span><span>PnL<strong class="${pnlClass(wallet.totalPnlUsd)}">${signedMoney(wallet.totalPnlUsd)}</strong></span></div><div class="old-copy-detail-tabs"><button class="${copyDetailTab==="positions"?"active":""}" data-copy-tab="positions" type="button">Pozycje <span>${positions.length}</span></button><button class="${copyDetailTab==="history"?"active":""}" data-copy-tab="history" type="button">Historia <span>${history.length}</span></button></div><div class="old-copy-cards">${copyDetailTab==="history"?historyMarkup:positionsMarkup}</div>`;
}

async function refresh(){
  const generation=++refreshGeneration,walletId=activeWalletId,managerId=activeManagerWalletId,copyId=activeCopyWalletId;
  try{
    const [scannerResponse,paperResponse,managerResponse,copyResponse]=await Promise.all([MemeConnection.fetch("/api/new-coins",{cache:"no-store"}),MemeConnection.fetch(`/api/paper?walletId=${encodeURIComponent(walletId)}`,{cache:"no-store"}),MemeConnection.fetch(managerUrl("/api/manager"),{cache:"no-store"}),MemeConnection.fetch(copyUrl("/api/copy"),{cache:"no-store"})]);
    if(scannerResponse.status===401||paperResponse.status===401||managerResponse.status===401||copyResponse.status===401){MemeConnection.login();return}
    if(!paperResponse.ok&&walletId!=="main"){activeWalletId="main";try{localStorage.setItem(paperWalletStorageKey,"main")}catch{}return refresh();}
    if(!managerResponse.ok&&managerId!=="main"){activeManagerWalletId="main";try{localStorage.setItem(managerWalletStorageKey,"main")}catch{}return refresh();}
    if(!copyResponse.ok&&copyId!=="main"){activeCopyWalletId="main";try{localStorage.setItem(copyWalletStorageKey,"main")}catch{}return refresh();}
    if(!scannerResponse.ok||!paperResponse.ok||!managerResponse.ok||!copyResponse.ok)throw Error();const scanner=await scannerResponse.json(),state=await paperResponse.json(),managerState=await managerResponse.json(),copyState=await copyResponse.json();if(generation!==refreshGeneration)return;tokens=scanner.tokens;feedStatus=scanner.status;paper=state;manager=managerState;copy=copyState;renderFeedStatus();renderScanner();renderPaper();renderManager();renderCopy();
  }catch{$("#connection").textContent="Brak połączenia z serwerem";$("#connection").classList.remove("live");}
}
function scheduleRefresh(delay=120){
  if(refreshTimer)return;
  refreshTimer=setTimeout(async()=>{refreshTimer=null;await refresh();},delay);
}

function applyFilters(){
  const raw=minMcInput.value.trim(),invalid=minMcInput.validity.badInput||(raw!==""&&(!Number.isFinite(Number(raw))||Number(raw)<0));
  minMcInput.setAttribute("aria-invalid",String(invalid));filterError.textContent=invalid?"Wpisz kwotę równą lub większą od zera.":"";clearFilters.disabled=false;if(invalid)return;
  minMarketCap=raw===""?null:Number(raw);try{if(minMarketCap===null)localStorage.removeItem(filterStorageKey);else localStorage.setItem(filterStorageKey,String(minMarketCap));}catch{}renderScanner();
}
minMcInput.addEventListener("input",applyFilters);clearFilters.addEventListener("click",()=>{minMcInput.value="";applyFilters();minMcInput.focus();});search.addEventListener("input",renderScanner);

$$('[data-bot-status]').forEach(button=>button.addEventListener('click',async()=>{try{acceptPaper(await request(paperUrl("/api/paper/status"),{method:"POST",body:JSON.stringify({status:button.dataset.botStatus})}));showMessage("#paperMessage",button.dataset.botStatus==="running"?"Bot działa i reaguje na zdarzenia ze skanera.":button.dataset.botStatus==="paused"?"Bot został wstrzymany.":"Bot został zatrzymany.");}catch(error){showMessage("#paperMessage",error.message,true);}}));
$$('[data-paper-tab]').forEach(button=>button.addEventListener('click',()=>{activePaperTab=button.dataset.paperTab;$$('[data-paper-tab]').forEach(item=>item.classList.toggle('active',item===button));$$('.paper-tab-panel').forEach(panel=>panel.classList.toggle('hidden',panel.id!==`${activePaperTab}Panel`));}));

$("#walletBalance").addEventListener("input",updateWalletConversion);$("#walletCurrency").addEventListener("change",updateWalletConversion);
$("#walletForm").addEventListener("submit",async event=>{event.preventDefault();const amount=Number($("#walletBalance").value),currency=$("#walletCurrency").value;if(!Number.isFinite(amount)||amount<=0)return;let balanceUsd=amount;if(currency==="SOL"){if(!(feedStatus.solPriceUsd>0))return showMessage("#paperMessage","Nie ma aktualnego kursu SOL. Wybierz USD lub spróbuj ponownie.",true);balanceUsd=amount*feedStatus.solPriceUsd;}if((paper?.positions.length||paper?.history.length)&&!confirm("To usunie pozycje i historię bieżącej sesji. Kontynuować?"))return;try{acceptPaper(await request(paperUrl("/api/paper/wallet"),{method:"POST",body:JSON.stringify({balanceUsd})}));showMessage("#paperMessage","Utworzono nową sesję paper tradingu.");}catch(error){showMessage("#paperMessage",error.message,true);}});
$("#clearSession").addEventListener("click",async()=>{if(!confirm("Wyczyścić wszystkie pozycje i historię oraz przywrócić saldo początkowe?"))return;try{acceptPaper(await request(paperUrl("/api/paper/reset"),{method:"POST",body:"{}"}));showMessage("#paperMessage","Sesja została wyczyszczona.");}catch(error){showMessage("#paperMessage",error.message,true);}});
$("#deletePaperWallet").addEventListener("click",async()=>{const wallet=paper?.wallets?.find(item=>item.id===activeWalletId);if(!wallet||paper.wallets.length<=1)return;if(!confirm(`Usunąć portfel „${wallet.name}” wraz z jego historią, pozycjami i ustawieniami?`))return;try{const state=await request(`/api/paper/wallets?walletId=${encodeURIComponent(activeWalletId)}`,{method:"DELETE",body:"{}"});activeWalletId=state.walletId;try{localStorage.setItem(paperWalletStorageKey,activeWalletId)}catch{}settingsHydrated=false;lastHistoryId=null;lastPositionIds=new Set();acceptPaper(state);showMessage("#paperMessage","Portfel został usunięty.");}catch(error){showMessage("#paperMessage",error.message,true);}});

$$('.time-unit').forEach(select=>select.addEventListener('change',()=>{const form=select.closest('form'),field=form?.elements.namedItem(select.dataset.timeUnitFor),value=Number(field?.value),oldFactor=timeUnitFactor(select.dataset.previousUnit||"seconds"),newFactor=timeUnitFactor(select.value);if(field&&field.value!==""&&Number.isFinite(value))field.value=String(value*oldFactor/newFactor);select.dataset.previousUnit=select.value;}));
$("#strategyForm").addEventListener("submit",async event=>{event.preventDefault();const config={};for(const element of event.currentTarget.elements){if(!element.name)continue;if(element.type==="checkbox")config[element.name]=element.checked;else{const unit=timeUnitFor(element.name),value=element.value===""?null:Number(element.value);config[element.name]=value===null?null:unit?value*timeUnitFactor(unit.value):value;}}if((config.partialTakeProfitPercent===null)!==(config.partialSellPercent===null))return showMessage("#settingsMessage","Uzupełnij oba pola częściowej sprzedaży albo zostaw oba puste.",true);try{settingsHydrated=false;acceptPaper(await request(paperUrl("/api/paper/config"),{method:"PUT",body:JSON.stringify(config)}));showMessage("#settingsMessage","Ustawienia zapisane dla wybranego portfela.");}catch(error){showMessage("#settingsMessage",error.message,true);}});
$("#clearStrategySettings").addEventListener("click",async()=>{if(!confirm("Przywrócić domyślne ustawienia strategii dla tego portfela? Pozycje, historia i saldo pozostaną bez zmian."))return;try{settingsHydrated=false;acceptPaper(await request(paperUrl("/api/paper/config/reset"),{method:"POST",body:"{}"}));showMessage("#settingsMessage","Przywrócono domyślne ustawienia.");}catch(error){showMessage("#settingsMessage",error.message,true);}});

$("#managerAddForm").addEventListener("submit",async event=>{event.preventDefault();try{manager=await request(managerUrl("/api/manager/tokens"),{method:"POST",body:JSON.stringify({mint:$("#managerMint").value})});$("#managerMint").value="";renderManager();showMessage("#managerMessage","Kupno zlecone. Menadżer będzie teraz pilnował sprzedaży według ustawień.");}catch(error){showMessage("#managerMessage",error.message,true);}});
$("#managerSettingsForm").addEventListener("submit",async event=>{event.preventDefault();const config={},form=event.currentTarget;for(const element of form.elements){if(!element.name)continue;const unit=[...form.querySelectorAll('.time-unit')].find(select=>select.dataset.timeUnitFor===element.name),value=element.value===""?null:Number(element.value);config[element.name]=value===null?null:unit?value*timeUnitFactor(unit.value):value;}try{manager=await request(managerUrl("/api/manager/config"),{method:"PUT",body:JSON.stringify(config)});form.dataset.hydrated="1";renderManager();showMessage("#managerSettingsMessage","Ustawienia Menadżera zapisane.");}catch(error){showMessage("#managerSettingsMessage",error.message,true);}});
$("#clearManagerSettings").addEventListener("click",async()=>{if(!confirm("Przywrócić domyślne ustawienia Menadżera? Pozycje i historia pozostaną bez zmian."))return;try{manager=await request(managerUrl("/api/manager/config/reset"),{method:"POST",body:"{}"});$("#managerSettingsForm").dataset.hydrated="";renderManager();showMessage("#managerSettingsMessage","Przywrócono domyślne ustawienia Menadżera.");}catch(error){showMessage("#managerSettingsMessage",error.message,true);}});

function openCopyConfig(edit=false){
  editingCopyWalletId=edit?activeCopyWalletId:null;$("#copyConfigTitle").textContent=edit?"Edytuj konfigurację":"Dodaj konfigurację";$("#copyConfigName").value=edit?(copy.walletName||""):`Copy ${(copy?.wallets?.length||0)+1}`;$("#copyConfigSource").value=edit?(copy.sourceWallet||""):"";$("#copyConfigBalance").value=edit?(copy.wallet?.initialBalanceUsd||1000):1000;$("#copyConfigBalance").disabled=edit;$("#copyConfigScale").value=edit?(copy.scalePercent||100):25;$("#copyConfigDelay").value=edit?(copy.config?.executionDelayMs||0):750;$("#copyConfigFee").value=edit?(copy.config?.platformFeePercent||0):0.5;$("#copyConfigFixedFee").value=edit?(copy.config?.networkFeeUsd||0):0.001;$("#copyConfigSlippage").value=edit?(copy.config?.slippagePercent||0):1;$("#copyConfigError").textContent="";$("#copyConfigDialog").showModal();
}
$("#openCopyConfig").addEventListener("click",()=>openCopyConfig(false));$("#emptyAddCopy").addEventListener("click",()=>openCopyConfig(false));$("#closeCopyConfig").addEventListener("click",()=>$("#copyConfigDialog").close());
$("#copyConfigList").addEventListener("click",async event=>{const row=event.target.closest("[data-copy-wallet]");if(!row)return;activeCopyWalletId=row.dataset.copyWallet;copyDetailTab="positions";try{localStorage.setItem(copyWalletStorageKey,activeCopyWalletId)}catch{}await refresh();});
$("#copyDetail").addEventListener("click",async event=>{const tab=event.target.closest("[data-copy-tab]");if(tab){copyDetailTab=tab.dataset.copyTab;renderCopy();return;}const mintButton=event.target.closest(".copy-mint");if(mintButton?.dataset.mint){try{await navigator.clipboard.writeText(mintButton.dataset.mint);const old=mintButton.textContent;mintButton.textContent="Skopiowano ✓";setTimeout(()=>mintButton.textContent=old,1200);}catch{}return;}const action=event.target.closest("[data-copy-action]")?.dataset.copyAction;if(!action)return;if(action==="edit"){openCopyConfig(true);return;}if(action==="toggle"){try{copy=await request(copyUrl("/api/copy/status"),{method:"POST",body:JSON.stringify({status:copy.status==="running"?"paused":"running"})});renderCopy();}catch(error){showMessage("#copyMessage",error.message,true);}return;}if(action==="reset"){if(!confirm("Zresetować saldo, pozycje i historię tej konfiguracji Copy?"))return;try{copy=await request(copyUrl("/api/copy/reset"),{method:"POST",body:"{}"});renderCopy();showMessage("#copyMessage","Konfiguracja Copy została zresetowana.");}catch(error){showMessage("#copyMessage",error.message,true);}return;}if(action==="delete"){if((copy.wallets?.length||0)<=1)return showMessage("#copyMessage","Musi pozostać co najmniej jedna konfiguracja.",true);if(!confirm(`Usunąć konfigurację „${copy.walletName}” wraz z pozycjami i historią?`))return;try{copy=await request(copyUrl("/api/copy/wallets"),{method:"DELETE",body:"{}"});activeCopyWalletId=copy.walletId;try{localStorage.setItem(copyWalletStorageKey,activeCopyWalletId)}catch{}copyDetailTab="positions";renderCopy();}catch(error){showMessage("#copyMessage",error.message,true);}}});
$("#copyConfigForm").addEventListener("submit",async event=>{event.preventDefault();const name=$("#copyConfigName").value.trim(),sourceWallet=$("#copyConfigSource").value.trim(),previousSource=copy?.sourceWallet||"",balanceUsd=Number($("#copyConfigBalance").value),config={...(copy?.config||{}),sourceWallet,scalePercent:Number($("#copyConfigScale").value),executionDelayMs:Number($("#copyConfigDelay").value),platformFeePercent:Number($("#copyConfigFee").value),networkFeeUsd:Number($("#copyConfigFixedFee").value),slippagePercent:Number($("#copyConfigSlippage").value),priceImpactPercent:0,autoSell:false};try{if(editingCopyWalletId){copy=await request(copyUrl("/api/copy/wallets"),{method:"PUT",body:JSON.stringify({name})});}else{copy=await request("/api/copy/wallets",{method:"POST",body:JSON.stringify({name,balanceUsd})});activeCopyWalletId=copy.walletId;try{localStorage.setItem(copyWalletStorageKey,activeCopyWalletId)}catch{}}copy=await request(copyUrl("/api/copy/config"),{method:"PUT",body:JSON.stringify(config)});if(!editingCopyWalletId||sourceWallet!==previousSource)copy=await request(copyUrl("/api/copy/source"),{method:"POST",body:JSON.stringify({sourceWallet})});$("#copyConfigDialog").close();copyDetailTab="positions";renderCopy();showMessage("#copyMessage",editingCopyWalletId?"Konfiguracja Copy została zapisana.":"Nowa konfiguracja Copy jest gotowa.");}catch(error){$("#copyConfigError").textContent=error.message;}});
$("#managerWalletSelect").addEventListener("change",async event=>{activeManagerWalletId=event.target.value;try{localStorage.setItem(managerWalletStorageKey,activeManagerWalletId)}catch{}$("#managerSettingsForm").dataset.hydrated="";await refresh();if(activeManagerView==="stats")refreshManagerStats();});
$("#newManagerWallet").addEventListener("click",()=>{$("#newManagerName").value=`Menadżer ${(manager?.wallets?.length||1)+1}`;$("#createManagerError").textContent="";$("#createManagerDialog").showModal();});$("#cancelCreateManager").addEventListener("click",()=>$("#createManagerDialog").close());
$("#createManagerForm").addEventListener("submit",async event=>{event.preventDefault();try{manager=await request("/api/manager/wallets",{method:"POST",body:JSON.stringify({name:$("#newManagerName").value,balanceUsd:Number($("#newManagerBalance").value),cloneConfigFrom:$("#cloneManagerSettings").checked?activeManagerWalletId:null})});activeManagerWalletId=manager.walletId;try{localStorage.setItem(managerWalletStorageKey,activeManagerWalletId)}catch{}$("#managerSettingsForm").dataset.hydrated="";$("#createManagerDialog").close();renderManager();}catch(error){$("#createManagerError").textContent=error.message;}});
$("#deleteManagerWallet").addEventListener("click",async()=>{const item=manager?.wallets?.find(wallet=>wallet.id===activeManagerWalletId);if(!item||manager.wallets.length<=1||!confirm(`Usunąć Menadżera „${item.name}” wraz z pozycjami i historią?`))return;try{manager=await request(managerUrl("/api/manager/wallets"),{method:"DELETE",body:"{}"});activeManagerWalletId=manager.walletId;try{localStorage.setItem(managerWalletStorageKey,activeManagerWalletId)}catch{}$("#managerSettingsForm").dataset.hydrated="";renderManager();}catch(error){showMessage("#managerMessage",error.message,true);}});

$("#paperWalletSelect").addEventListener("change",async event=>{activeWalletId=event.target.value;try{localStorage.setItem(paperWalletStorageKey,activeWalletId)}catch{}settingsHydrated=false;lastHistoryId=null;lastPositionIds=new Set();await refresh();if(activePaperView==="stats")await refreshStats();});
$("#prevStatsMonth").addEventListener("click",()=>{statsMonth--;if(statsMonth<0){statsMonth=11;statsYear--;}selectedStatsDay=null;renderStatsCalendar();});
$("#nextStatsMonth").addEventListener("click",()=>{statsMonth++;if(statsMonth>11){statsMonth=0;statsYear++;}selectedStatsDay=null;renderStatsCalendar();});
$("#newPaperWallet").addEventListener("click",()=>{$("#newWalletName").value="Paper "+((paper?.wallets?.length||1)+1);$("#createWalletError").textContent="";$("#createWalletDialog").showModal();});
$("#cancelCreateWallet").addEventListener("click",()=>$("#createWalletDialog").close());
$("#createWalletForm").addEventListener("submit",async event=>{
  event.preventDefault();
  try{
    const state=await request("/api/paper/wallets",{method:"POST",body:JSON.stringify({name:$("#newWalletName").value,balanceUsd:Number($("#newWalletBalance").value),cloneConfigFrom:$("#cloneSettings").checked?activeWalletId:null})});
    activeWalletId=state.walletId;try{localStorage.setItem(paperWalletStorageKey,activeWalletId)}catch{}
    settingsHydrated=false;lastHistoryId=null;lastPositionIds=new Set();$("#createWalletDialog").close();acceptPaper(state);
    showMessage("#paperMessage","Nowy niezależny portfel jest gotowy.");
  }catch(error){$("#createWalletError").textContent=error.message;}
});

$("#logout").addEventListener("click",async()=>{try{await request("/api/auth/logout",{method:"POST",body:"{}"})}finally{MemeConnection.saveToken("");MemeConnection.login()}});
async function boot(){
  try{
    const response=await MemeConnection.fetch("/api/auth/me",{cache:"no-store"});
    if(!response.ok){MemeConnection.login();return}
    const data=await response.json();currentUser=data.user;
    $("#accountName").textContent=currentUser.name;
    paperWalletStorageKey=`meme-pilot:active-paper-wallet:${currentUser.id}`;
    managerWalletStorageKey=`meme-pilot:active-manager-wallet:${currentUser.id}`;copyWalletStorageKey=`meme-pilot:active-copy-wallet:${currentUser.id}`;
    try{activeWalletId=localStorage.getItem(paperWalletStorageKey)||"main";activeManagerWalletId=localStorage.getItem(managerWalletStorageKey)||"main";activeCopyWalletId=localStorage.getItem(copyWalletStorageKey)||"main"}catch{}
    renderScanner();await refresh();
    if(activePaperView==="stats")refreshStats();
    if(!MemeConnection.remote){
    const events=new EventSource("/api/events");
    events.onmessage=event=>{scheduleRefresh();try{const type=JSON.parse(event.data).type;if(activePaperView==="stats"&&["paper-trade","paper-reset"].includes(type))refreshStats();}catch{}};
    }
    setInterval(()=>scheduleRefresh(0),MemeConnection.remote?3000:10000);
    setInterval(()=>{if(activePaperView==="stats")refreshStats();if(activeManagerView==="stats")refreshManagerStats();},5000);
  }catch{$("#connection").textContent="Brak połączenia z serwerem";setTimeout(boot,5000);}
}
boot();

