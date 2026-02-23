// ui.js - UI render helpers
export function el(tag, attrs={}, children=[]) {
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

export function money(n){
  const v = Number(n||0);
  return v.toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' Kč';
}
export function hoursFromMinutes(mins){
  const m = Number(mins||0);
  const h = Math.floor(m/60);
  const mm = m%60;
  return `${h} h ${String(mm).padStart(2,'0')} min`;
}
export function pill(state){
  if (state==='paid') return el('span',{class:'pill ok'},['🟢 Zaplaceno']);
  if (state==='awaiting_payment') return el('span',{class:'pill bad'},['🔴 Čeká na zaplacení']);
  if (state==='ready_to_invoice') return el('span',{class:'pill warn'},['🟡 Připraveno']);
  return el('span',{class:'pill warn'},['🟡 Rozpracováno']);
}
