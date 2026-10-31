const form=document.querySelector("#authForm");
const error=document.querySelector("#authError");
let account={slot:1,configured:false};
function applyAccountState(){
  const configured=Boolean(account.configured);
  document.querySelector("#authTitle").textContent=configured?"Logowanie":"Ustaw hasło";
  document.querySelector("#authSubmit").textContent=configured?"Zaloguj":"Ustaw hasło i wejdź";
  document.querySelector("#authPassword").autocomplete=configured?"current-password":"new-password";
  document.querySelector("#repeatPasswordField").classList.toggle("hidden",configured);
  document.querySelector("#setupCodeField").classList.toggle("hidden",configured);
}
async function loadAccounts(){
  try{const response=await MemeConnection.fetch("/api/auth/setup",{cache:"no-store"});const data=await response.json();if(!response.ok)throw Error();account=(data.accounts||[]).find(item=>item.slot===1)||account;applyAccountState();}
  catch{ /* The connection banner remains visible while offline. */ }
  finally{setTimeout(loadAccounts,5000);}
}
form.addEventListener("submit",async event=>{
  event.preventDefault();error.textContent="";
  const password=document.querySelector("#authPassword").value;
  if(!account.configured&&password!==document.querySelector("#repeatPassword").value){error.textContent="Hasła nie są takie same.";return}
  const submit=document.querySelector("#authSubmit");submit.disabled=true;
  try{
    const response=await MemeConnection.fetch(account.configured?"/api/auth/login":"/api/auth/register",{
      method:"POST",headers:{"Content-Type":"application/json","X-Meme-Pilot-Request":"1"},
      body:JSON.stringify({slot:account.slot,password,setupCode:document.querySelector("#setupCode").value})
    });
    const data=await response.json();if(!response.ok)throw Error(data.error||"Nie udało się zalogować.");MemeConnection.saveToken(data.token);MemeConnection.home();
  }catch(cause){error.textContent=cause.message;submit.disabled=false;}
});
loadAccounts();

