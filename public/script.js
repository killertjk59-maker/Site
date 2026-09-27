const foods=[
{id:1,name:"Паста Трюфель",cat:"Асосӣ",price:68,img:"https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=1000&q=80",desc:"Пастаи хонагӣ бо креми пармезан, занбӯруғ ва равғани трюфель."},
{id:2,name:"Стейк OSHONA",cat:"Асосӣ",price:119,img:"https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=1000&q=80",desc:"Гӯшти мулоим бо сабзавоти мавсимӣ ва соуси махсуси chef."},
{id:3,name:"Бургер Classic",cat:"Fast Food",price:49,img:"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1000&q=80",desc:"Булочкаи бирёншуда, гӯшти 100% гов, панир ва соуси хонагӣ."},
{id:4,name:"Caesar",cat:"Салат",price:42,img:"https://images.unsplash.com/photo-1546793665-c74683f339c1?auto=format&fit=crop&w=1000&q=80",desc:"Салати тару тоза бо мурғ, пармезан ва dressing-и классикӣ."},
{id:5,name:"Pizza Burrata",cat:"Pizza",price:62,img:"https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=1000&q=80",desc:"Pizza бо помидор, mozzarella, burrata ва райҳони тару тоза."},
{id:6,name:"Cheesecake",cat:"Ширинӣ",price:35,img:"https://images.unsplash.com/photo-1565958011703-44f9829ba187?auto=format&fit=crop&w=1000&q=80",desc:"Cheesecake-и нарм бо соуси буттамева ва меваҳои мавсимӣ."},
{id:7,name:"Mojito Fresh",cat:"Нӯшокиҳо",price:24,img:"https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=1000&q=80",desc:"Лимӯ, наъно, сода ва шарбати табиӣ — бе алкогол."},
{id:8,name:"Chef Signature",cat:"Chef",price:79,img:"https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1000&q=80",desc:"Таоми махсуси chef бо гӯшти мулоим, сабзавот ва соуси OSHONA."}
];

let cart=JSON.parse(localStorage.getItem("oshonaCart")||"[]");
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);

window.addEventListener("load",()=>setTimeout(()=>$("#loader").classList.add("hide"),600));
window.addEventListener("scroll",()=>$("#header").classList.toggle("scrolled",scrollY>40));

const categories=["Ҳама","Асосӣ","Fast Food","Салат","Pizza","Ширинӣ","Нӯшокиҳо"];
$("#filters").innerHTML=categories.map((c,i)=>`<button class="filter ${i===0?"active":""}" data-cat="${c}">${c}</button>`).join("");

function renderFoods(cat="Ҳама"){
  const list=cat==="Ҳама"?foods:foods.filter(f=>f.cat===cat);
  $("#foodGrid").innerHTML=list.map(f=>`
    <article class="food-card reveal" data-id="${f.id}">
      <div class="food-image" style="background-image:url('${f.img}')"></div>
      <div class="food-info"><div class="food-top"><h3>${f.name}</h3><span class="price">${f.price} с.</span></div>
      <p>${f.desc}</p><button class="add" data-add="${f.id}">+ Ба сабад</button></div>
    </article>`).join("");
  observeReveals();
}
renderFoods();

$("#filters").addEventListener("click",e=>{
 const b=e.target.closest(".filter"); if(!b)return;
 $$(".filter").forEach(x=>x.classList.remove("active")); b.classList.add("active"); renderFoods(b.dataset.cat);
});

document.addEventListener("click",e=>{
 const add=e.target.closest("[data-add]"); if(add){addToCart(+add.dataset.add);return}
 const card=e.target.closest(".food-card"); if(card && !e.target.closest("button")) openFood(+card.dataset.id);
 if(e.target.matches("[data-close]")) closeAll();
 if(e.target.id==="cartBtn") openCart();
 if(e.target.id==="checkoutBtn") openCheckout();
 if(e.target.id==="heroReserve"){document.querySelector("#reservation").scrollIntoView({behavior:"smooth"})}
});

function addToCart(id){
 const item=cart.find(x=>x.id===id); if(item)item.qty++; else cart.push({id,qty:1});
 saveCart(); toast("Ба сабад илова шуд ✓");
}
function saveCart(){localStorage.setItem("oshonaCart",JSON.stringify(cart)); renderCart();}
function renderCart(){
 const count=cart.reduce((s,x)=>s+x.qty,0); $("#cartCount").textContent=count;
 const items=$("#cartItems"); $("#cartEmpty").style.display=cart.length?"none":"block";
 items.innerHTML=cart.map(x=>{const f=foods.find(a=>a.id===x.id);return `<div class="cart-row"><img src="${f.img}"><div><h4>${f.name}</h4><small>${f.price} с.</small><div class="qty"><button data-minus="${f.id}">−</button><span>${x.qty}</span><button data-plus="${f.id}">+</button></div></div><strong>${f.price*x.qty} с.</strong></div>`}).join("");
 $("#cartTotal").textContent=cart.reduce((s,x)=>s+foods.find(f=>f.id===x.id).price*x.qty,0)+" с.";
}
renderCart();

document.addEventListener("click",e=>{
 if(e.target.dataset.plus){const x=cart.find(a=>a.id==e.target.dataset.plus);x.qty++;saveCart()}
 if(e.target.dataset.minus){const x=cart.find(a=>a.id==e.target.dataset.minus);x.qty--;if(x.qty<=0)cart=cart.filter(a=>a!==x);saveCart()}
});

function openCart(){closeModals();$("#overlay").classList.add("show");$("#cartDrawer").classList.add("open");document.body.classList.add("lock")}
function openFood(id){const f=foods.find(x=>x.id===id);$("#foodModalContent").innerHTML=`<div class="modal-food"><img src="${f.img}"><div><p class="eyebrow">${f.cat}</p><h2>${f.name}</h2><p>${f.desc}</p><strong class="price">${f.price} с.</strong><button class="btn btn-primary full" style="margin-top:25px" data-add="${f.id}">Ба сабад илова кардан</button></div></div>`;$("#overlay").classList.add("show");$("#foodModal").classList.add("show");document.body.classList.add("lock")}
function openCheckout(){if(!cart.length){toast("Аввал ба сабад хӯрок илова кунед.");return}$("#cartDrawer").classList.remove("open");$("#checkoutModal").classList.add("show")}
function closeAll(){closeModals();$("#overlay").classList.remove("show");document.body.classList.remove("lock")}
function closeModals(){$$("#foodModal,.small-modal").forEach(x=>x.classList.remove("show"));$("#cartDrawer").classList.remove("open")}
$("#overlay").addEventListener("click",closeAll);

$("#checkoutForm").addEventListener("submit",e=>{e.preventDefault();const order={...Object.fromEntries(new FormData(e.target)),items:cart,date:new Date().toISOString()};localStorage.setItem("lastOshonaOrder",JSON.stringify(order));cart=[];saveCart();closeAll();toast("Фармоиши шумо қабул шуд! ✓");e.target.reset()});
$("#reservationForm").addEventListener("submit",e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));localStorage.setItem("oshonaReservation",JSON.stringify(d));e.target.reset();toast("Миз барои шумо банд карда шуд! ✓")});
$("#searchBtn").addEventListener("click",()=>{const q=prompt("Чиро ҷустуҷӯ мекунед?");if(!q)return;const f=foods.find(x=>x.name.toLowerCase().includes(q.toLowerCase()));if(f){openFood(f.id)}else toast("Ҳеҷ чиз ёфт нашуд.")});
$("#menuToggle").addEventListener("click",()=>$("#nav").classList.toggle("open"));
$("#allMenuBtn").addEventListener("click",()=>{renderFoods();document.querySelector("#menu").scrollIntoView({behavior:"smooth"})});

function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2300)}
function observeReveals(){const obs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add("visible")}),{threshold:.12});$$(".reveal:not(.visible)").forEach(x=>obs.observe(x))}
observeReveals();

/* ===== OSHONA BACKEND CONNECTION ===== */
const OSHONA_API = "/api";
async function apiRequest(path, options={}) {
  const response = await fetch(OSHONA_API + path, {
    ...options,
    headers: {"Content-Type":"application/json", ...(options.headers||{})}
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || "API error");
  return data;
}

async function syncMenuFromBackend() {
  try {
    const data = await apiRequest("/foods");
    if (Array.isArray(data) && data.length) {
      foods.length = 0;
      data.forEach(f => foods.push({id:f.id,name:f.name,cat:f.category,price:f.price,img:f.image,desc:f.description}));
      renderFoods();
    }
  } catch (e) { console.warn("Backend unavailable; local menu remains active.", e.message); }
}
syncMenuFromBackend();

/* Capture-phase handler replaces the demo-only checkout handler with the real API flow. */
const realCheckout = document.getElementById("checkoutForm");
if (realCheckout) realCheckout.addEventListener("submit", async (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  try {
    const form = Object.fromEntries(new FormData(realCheckout));
    const paymentMethod = form.method === "cash" ? "cash" : "online";
    const order = await apiRequest("/orders", {
      method:"POST",
      body:JSON.stringify({
        customerName:form.name,
        phone:form.phone,
        address:form.address,
        method:"delivery",
        paymentMethod,
        paymentProvider: paymentMethod === "online" ? "manual" : null,
        items:cart.map(x=>({foodId:x.id,quantity:x.qty}))
      })
    });

    if (paymentMethod === "online") {
      localStorage.setItem("oshonaPendingOrder", JSON.stringify(order));
      cart=[]; saveCart(); realCheckout.reset();
      document.getElementById("checkoutModal").classList.remove("show");
      showPaymentSheet(order);
      return;
    } else {
      toast("Фармоиши нақдӣ қабул шуд ✓");
    }
    cart=[]; saveCart(); closeAll(); realCheckout.reset();
  } catch (err) {
    toast("Хатогӣ: " + err.message);
  }
}, true);

/* ===== OSHONA RESERVATION → BACKEND ===== */
const realReservation = document.getElementById("reservationForm");
if (realReservation) realReservation.addEventListener("submit", async (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  const data = Object.fromEntries(new FormData(realReservation));
  try {
    await apiRequest("/reservations", { method: "POST", body: JSON.stringify(data) });
    toast("Миз барои шумо банд карда шуд! ✓");
  } catch (err) {
    // Агар сервер дастнорас бошад — мисли пештара дар браузер нигоҳ дор
    localStorage.setItem("oshonaReservation", JSON.stringify(data));
    toast("Миз банд шуд (офлайн) ✓");
  }
  realReservation.reset();
}, true);
