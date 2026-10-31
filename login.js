const form=document.querySelector("#authForm");
const error=document.querySelector("#authError");
const choices=document.querySelector("#accountChoices");
let accounts=[],selected=null;

function renderChoices(){
  choices.innerHTML=accounts.map(account=>`<button class="account-choice" type="button" data-slot="${account.slot}"><span>${account.slot}</span><strong>Konto ${account.slot}</strong><small>${account.configured?"Wpisz hasło":"Pierwsze wejście · ustaw hasło"}</small></button>`).join("");
  choices.querySelectorAll("button").forEach(button=>button.addEventListener("click",()=>selectAccount(Number(button.dataset.slot))));
}
function selectAccount(slot){
  selected=accounts.find(account=>account.slot===slot);if(!selected)return;
  choices.classList.add("hidden");form.classList.remove("hidden");
  document.querySelector("#authTitle").textContent=selected.configured?"Wpisz hasło":"Ustaw hasło";
  document.querySelector("#selectedAccountName").textContent=`Konto ${slot}`;
  document.querySelector("#authSubmit").textContent=selected.configured?"Zaloguj":"Ustaw hasło i wejdź";
  document.querySelector("#authPassword").autocomplete=selected.configured?"current-password":"new-password";
  document.querySelector("#repeatPasswordField").classList.toggle("hidden",selected.configured);
  document.querySelector("#setupCodeField").classList.toggle("hidden",selected.configured);
  document.querySelector("#authPassword").focus();
}
document.querySelector("#backToAccounts").addEventListener("click",()=>{
  selected=null;form.reset();error.textContent="";form.classList.add("hidden");choices.classList.remove("hidden");document.querySelector("#authTitle").textContent="Kto korzysta?";
});
async function loadAccounts(){
  try{const response=await MemeConnection.fetch("/api/auth/setup",{cache:"no-store"});const data=await response.json();if(!response.ok)throw Error();accounts=data.accounts||[];if(!selected)renderChoices();}
  catch{ /* The connection banner remains visible while offline. */ }
  finally{setTimeout(loadAccounts,5000);}
}
form.addEventListener("submit",async event=>{
  event.preventDefault();error.textContent="";if(!selected)return;
  const password=document.querySelector("#authPassword").value;
  if(!selected.configured&&password!==document.querySelector("#repeatPassword").value){error.textContent="Hasła nie są takie same.";return}
  const submit=document.querySelector("#authSubmit");submit.disabled=true;
  try{
    const response=await MemeConnection.fetch(selected.configured?"/api/auth/login":"/api/auth/register",{
      method:"POST",headers:{"Content-Type":"application/json","X-Meme-Pilot-Request":"1"},
      body:JSON.stringify({slot:selected.slot,password,setupCode:document.querySelector("#setupCode").value})
    });
    const data=await response.json();if(!response.ok)throw Error(data.error||"Nie udało się zalogować.");MemeConnection.saveToken(data.token);MemeConnection.home();
  }catch(cause){error.textContent=cause.message;submit.disabled=false;}
});
loadAccounts();

