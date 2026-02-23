// app.js - simple SPA (hash routing), offline-first
import {
  ensureDefaults, getSettings, saveSettings,
  listJobs, createJob, getJob, updateJob,
  listEntries, addEntry, updateEntry, deleteEntry,
  getInvoiceByJob, prepareInvoice, cancelPreparedInvoice, issueInvoice,
  exportBackup, wipeAndRestore, markInvoiceExported, markInvoiceSent, markPaid
} from './db.js';

import { el, money, hoursFromMinutes, pill } from './ui.js';

const view = document.getElementById('view');
const btnSettings = document.getElementById('btnSettings');

function setActiveTab(route){
  document.querySelectorAll('.tab').forEach(a=>{
    a.classList.toggle('active', a.dataset.route === route);
  });
}

function route(){
  const hash = location.hash || '#/home';
  const parts = hash.replace('#','').split('?');
  const path = parts[0] || '/home';
  const qs = new URLSearchParams(parts[1]||'');
  return { path, qs };
}

function fmtDate(d){
  const dt = new Date(d);
  return dt.toLocaleDateString('cs-CZ');
}

async function renderHome(){
  setActiveTab('/home');
  const settings = await getSettings();
  const jobs = await listJobs({ status:'all' });
  // simple dashboard
  let unpaidTotal = 0;
  for (const j of jobs){
    if (j.status === 'awaiting_payment') {
      const inv = await getInvoiceByJob(j.id);
      unpaidTotal += Number(inv?.total||0);
    }
  }
  view.innerHTML='';
  view.appendChild(el('div',{class:'grid cols2'},[
    el('div',{class:'card'},[
      el('div',{class:'h1'},['Rychlý přehled']),
      el('div',{class:'row'},[
        el('span',{class:'pill warn'},['📅 Dnes: ', fmtDate(new Date())]),
        el('span',{class:'pill bad'},['💰 Nezaplaceno: ', money(unpaidTotal)])
      ]),
      el('div',{class:'hr'}),
      el('div',{class:'row'},[
        el('button',{class:'btn primary', onclick:()=>{ location.hash='#/jobs?new=1'; }},['+ Nová zakázka']),
        el('button',{class:'btn', onclick:()=>{ location.hash='#/jobs'; }},['📁 Přehled zakázek'])
      ]),
      el('p',{class:'muted small'},['Tip: Dělej pravidelně zálohu v Nastavení → Data.'])
    ]),
    el('div',{class:'card'},[
      el('div',{class:'h1'},['Kontakt v hlavičce']),
      el('p',{class:'muted'},['Telefon a e-mail se berou z Nastavení faktur.']),
      el('div',{class:'row'},[
        el('span',{class:'pill'},['📞 ', settings?.phone || '']),
        el('span',{class:'pill'},['✉️ ', settings?.email || ''])
      ])
    ])
  ]));
}

function jobForm(onSubmit){
  const title = el('input',{class:'input', placeholder:'Název zakázky (např. Oprava linky XY)'});
  const note = el('textarea',{class:'input', rows:'3', placeholder:'Poznámka (volitelné)'});
  const rate = el('input',{class:'input', type:'number', step:'1', placeholder:'Sazba Kč/h (volitelné)'});
  return el('div',{class:'card'},[
    el('div',{class:'h1'},['Nová zakázka']),
    el('label',{},['Název zakázky']),
    title,
    el('label',{},['Poznámka']),
    note,
    el('label',{},['Výchozí sazba pro zakázku (Kč/h)']),
    rate,
    el('div',{class:'row', style:'margin-top:10px'},[
      el('button',{class:'btn primary', onclick: async ()=>{
        const v = title.value.trim();
        if (!v) { alert('Zadej název zakázky'); return; }
        await onSubmit({ title:v, note: note.value.trim(), hour_rate_default: rate.value ? Number(rate.value) : null });
      }},['Uložit zakázku'])
    ])
  ]);
}

async function renderJobs(){
  setActiveTab('/jobs');
  const { qs } = route();
  const q = qs.get('q') || '';
  const status = qs.get('status') || 'all';

  const controls = el('div',{class:'card'},[
    el('div',{class:'h1'},['Zakázky']),
    el('div',{class:'row'},[
      el('input',{class:'input', style:'max-width:360px', placeholder:'Hledat…', value:q, oninput:(e)=>{
        const v=e.target.value;
        const u=new URLSearchParams(location.hash.split('?')[1]||'');
        u.set('q', v);
        location.hash = '#/jobs?' + u.toString();
      }}),
      el('select',{class:'select', style:'max-width:220px', onchange:(e)=>{
        const u=new URLSearchParams(location.hash.split('?')[1]||'');
        u.set('status', e.target.value);
        location.hash = '#/jobs?' + u.toString();
      }},[
        el('option',{value:'all', selected: status==='all'},['Vše']),
        el('option',{value:'open', selected: status==='open'},['Rozpracované']),
        el('option',{value:'ready_to_invoice', selected: status==='ready_to_invoice'},['Připravené k vydání']),
        el('option',{value:'awaiting_payment', selected: status==='awaiting_payment'},['Čeká na zaplacení']),
        el('option',{value:'paid', selected: status==='paid'},['Zaplacené'])
      ]),
      el('button',{class:'btn primary', onclick:()=>{ location.hash='#/jobs?new=1'; }},['+ Nová zakázka'])
    ])
  ]);

  view.innerHTML='';
  view.appendChild(controls);

  if (qs.get('new') === '1') {
    view.appendChild(jobForm(async (data)=>{
      const id = await createJob(data);
      location.hash = '#/job?id=' + id;
    }));
  }

  const rows = await listJobs({ status, q });
  const list = el('div',{class:'grid'}, rows.length ? rows.map(j=>{
    return el('div',{class:'card'},[
      el('div',{class:'row', style:'justify-content:space-between'},[
        el('div',{},[
          el('div',{style:'font-weight:800'},[j.title]),
          el('div',{class:'muted small'},[j.note || ''])
        ]),
        pill(j.status)
      ]),
      el('div',{class:'row', style:'margin-top:10px'},[
        el('button',{class:'btn', onclick:()=>{ location.hash='#/job?id='+j.id; }},['Detail']),
      ])
    ]);
  }) : [
    el('div',{class:'card'},[
      el('div',{class:'muted'},['Zatím žádné zakázky. Klikni na „Nová zakázka“.'])
    ])
  );

  view.appendChild(list);
}

function entryForm(settings, job, onSubmit){
  const today = new Date().toISOString().slice(0,10);
  const work_date = el('input',{class:'input', type:'date', value: today});
  const time_from = el('input',{class:'input', type:'time', value:'08:00'});
  const time_to   = el('input',{class:'input', type:'time', value:'16:00'});
  const break_minutes = el('input',{class:'input', type:'number', step:'5', value:'30'});
  const hour_rate = el('input',{class:'input', type:'number', step:'1', value: String(job.hour_rate_default ?? settings.default_hour_rate ?? 0)});
  const activity = el('textarea',{class:'input', rows:'3', placeholder:'Co se dělalo…'});

  return el('div',{class:'card'},[
    el('div',{class:'h1'},['+ Nový záznam práce']),
    el('div',{class:'grid cols2'},[
      el('div',{},[el('label',{},['Datum']), work_date]),
      el('div',{},[el('label',{},['Přestávka (min)']), break_minutes]),
      el('div',{},[el('label',{},['Od']), time_from]),
      el('div',{},[el('label',{},['Do']), time_to]),
      el('div',{},[el('label',{},['Sazba Kč/h']), hour_rate]),
      el('div',{},[el('label',{},[' ']), el('div',{class:'muted small'},['Tip: Do může být i další den (noční).'])]),
    ]),
    el('label',{},['Činnost']),
    activity,
    el('div',{class:'row', style:'margin-top:10px'},[
      el('button',{class:'btn primary', onclick: async ()=>{
        await onSubmit({
          work_date: work_date.value,
          time_from: time_from.value,
          time_to: time_to.value,
          break_minutes: Number(break_minutes.value||0),
          hour_rate: Number(hour_rate.value||0),
          activity: activity.value.trim()
        });
        activity.value='';
      }},['Uložit záznam'])
    ])
  ]);
}

function invoiceControls(job, inv){
  const wrap = el('div',{class:'card'});
  wrap.appendChild(el('div',{class:'h1'},['Faktura']));
  wrap.appendChild(el('div',{class:'row'},[
    el('span',{class:'pill ' + (inv.state==='draft'?'warn':inv.state==='prepared'?'warn':'ok')},[
      inv.state==='draft' ? '📝 Koncept' : inv.state==='prepared' ? `🟡 Připraveno (${inv.number_text})` : `📄 Vydáno (${inv.number_text})`
    ]),
    inv.period_from ? el('span',{class:'pill'},[`📅 ${inv.period_from} – ${inv.period_to}`]) : el('span',{class:'pill'},['📅 bez záznamů']),
    el('span',{class:'pill'},['💰 ', money(inv.total||0)])
  ]));

  const issueDateInput = el('input',{class:'input', type:'date', value: (inv.issue_date || new Date().toISOString().slice(0,10))});
  wrap.appendChild(el('div',{class:'grid cols2', style:'margin-top:10px'},[
    el('div',{},[el('label',{},['Datum vystavení (pro číslo faktury)']), issueDateInput]),
    el('div',{},[el('label',{},['Akce']), el('div',{class:'row'},[
      el('button',{class:'btn', onclick: async ()=>{
        // Simple HTML print preview (browser -> Save as PDF)
        await markInvoiceExported(job.id);
        const html = await buildInvoiceHtml(job.id);
        const w = window.open('', '_blank');
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
      }},['Náhled / PDF (tisk)']),
      el('button',{class:'btn', onclick: async ()=>{
        // share mailto (PWA safe) – attachment is manual
        await markInvoiceSent(job.id);
        const subj = encodeURIComponent(`Faktura ${inv.number_text || ''} – RAVITO`);
        const body = encodeURIComponent(`Dobrý den,\n\nv příloze zasílám fakturu ${inv.number_text || ''}.\n\nRAVITO\n${(await getSettings()).phone}\n${(await getSettings()).email}\n`);
        location.href = `mailto:?subject=${subj}&body=${body}`;
      }},['Odeslat e-mailem'])
    ])])
  ]));

  const btnPrepare = el('button',{class:'btn primary'},['Připravit (přidělit číslo)']);
  const btnCancel = el('button',{class:'btn danger'},['Zrušit připravenou (uvolnit číslo)']);
  const btnIssue  = el('button',{class:'btn primary'},['Vydat (uzamknout)']);
  const btnPaid = el('button',{class:'btn'},['Označit zaplaceno']);

  btnPrepare.onclick = async ()=>{
    if (inv.total<=0){ alert('Nejdřív přidej aspoň jeden záznam práce.'); return; }
    try { await prepareInvoice(job.id, issueDateInput.value); location.hash = '#/job?id='+job.id; }
    catch(e){ alert(e.message||String(e)); }
  };
  btnCancel.onclick = async ()=>{
    if (!confirm('Zrušit připravenou fakturu a posunout čísla zpět?')) return;
    try { await cancelPreparedInvoice(job.id, 'Zrušeno uživatelem'); location.hash = '#/job?id='+job.id; }
    catch(e){ alert(e.message||String(e)); }
  };
  btnIssue.onclick = async ()=>{
    if (!confirm('Vydat fakturu? Po vydání už nepůjde měnit číslo.')) return;
    try { await issueInvoice(job.id); location.hash = '#/job?id='+job.id; }
    catch(e){ alert(e.message||String(e)); }
  };
  btnPaid.onclick = async ()=>{
    await markPaid(job.id);
    location.hash = '#/job?id='+job.id;
  };

  const actions = el('div',{class:'row', style:'margin-top:10px'});
  if (inv.state==='draft') actions.appendChild(btnPrepare);
  if (inv.state==='prepared') { actions.appendChild(btnIssue); actions.appendChild(btnCancel); }
  if (inv.state==='issued') actions.appendChild(btnPaid);

  wrap.appendChild(actions);

  wrap.appendChild(el('p',{class:'muted small', style:'margin-top:10px'},[
    'Pozn.: „Náhled / PDF“ otevře tiskový náhled. V prohlížeči zvolíš „Uložit jako PDF“.'
  ]));

  return wrap;
}

async function buildInvoiceHtml(jobId){
  const settings = await getSettings();
  const job = await getJob(jobId);
  const inv = await getInvoiceByJob(jobId);
  const entries = await listEntries(jobId);

  const rows = entries.map(e=>`
    <tr>
      <td>${e.work_date}</td>
      <td>${e.time_from}–${e.time_to} (pauza ${e.break_minutes}m)</td>
      <td>${escapeHtml(e.activity||'')}</td>
      <td style="text-align:right">${(e.minutes_total/60).toFixed(2)}</td>
      <td style="text-align:right">${Number(e.hour_rate).toLocaleString('cs-CZ')}</td>
      <td style="text-align:right">${Number(e.price_total).toLocaleString('cs-CZ')}</td>
    </tr>
  `).join('');

  const title = inv.state==='issued' ? 'FAKTURA' : 'NÁHLED FAKTURY (KONCEPT)';
  const num = inv.number_text ? inv.number_text : '—';
  const issue = inv.issue_date ? inv.issue_date : '—';
  const due = inv.due_date ? inv.due_date : '—';

  const css = `
    body{font-family:Arial, sans-serif; margin:28px; color:#111}
    .top{display:flex; justify-content:space-between; gap:24px}
    .box{border:1px solid #ddd; padding:12px; border-radius:10px}
    h1{margin:0 0 8px 0}
    table{width:100%; border-collapse:collapse; margin-top:14px}
    th,td{border-bottom:1px solid #eee; padding:8px; vertical-align:top; font-size:12px}
    th{background:#fafafa; text-align:left}
    .sum{margin-top:14px; display:flex; justify-content:flex-end}
    .sum .box{min-width:260px}
    .muted{color:#666; font-size:12px}
    @media print {.no-print{display:none}}
  `;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} ${num}</title><style>${css}</style></head>
  <body>
    <div class="top">
      <div>
        <h1>${settings.company_name}</h1>
        <div class="muted">tel: ${settings.phone} • email: ${settings.email}</div>
        <div style="margin-top:10px"><b>Zakázka:</b> ${escapeHtml(job.title)}</div>
      </div>
      <div class="box">
        <div style="font-size:18px; font-weight:800">${title}</div>
        <div><b>Číslo:</b> ${num}</div>
        <div><b>Vystaveno:</b> ${issue}</div>
        <div><b>Splatnost:</b> ${due}</div>
        <div><b>Období:</b> ${inv.period_from||'—'} – ${inv.period_to||'—'}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Datum</th>
          <th>Čas</th>
          <th>Činnost</th>
          <th style="text-align:right">Hod</th>
          <th style="text-align:right">Kč/h</th>
          <th style="text-align:right">Kč</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="6" class="muted">Bez záznamů</td></tr>`}
      </tbody>
    </table>

    <div class="sum">
      <div class="box">
        <div style="display:flex; justify-content:space-between"><span>Celkem</span><b>${Number(inv.total||0).toLocaleString('cs-CZ')} Kč</b></div>
      </div>
    </div>

    <p class="muted no-print">Tip: Tisk → Uložit jako PDF. QR platbu doplníme v další iteraci.</p>
  </body></html>`;
}

function escapeHtml(s){
  return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

async function renderJobDetail(){
  setActiveTab('/jobs');
  const { qs } = route();
  const id = Number(qs.get('id'));
  const job = await getJob(id);
  if (!job) { view.innerHTML=''; view.appendChild(el('div',{class:'card'},['Zakázka nenalezena.'])); return; }

  const settings = await getSettings();
  const inv = await getInvoiceByJob(id);
  const entries = await listEntries(id);

  view.innerHTML='';
  view.appendChild(el('div',{class:'card'},[
    el('div',{class:'row', style:'justify-content:space-between'},[
      el('div',{},[
        el('div',{class:'h1'},[job.title]),
        el('div',{class:'muted'},[job.note||''])
      ]),
      pill(job.status)
    ]),
    el('div',{class:'row', style:'margin-top:10px'},[
      el('button',{class:'btn', onclick:()=>{ location.hash='#/jobs'; }},['⬅️ Zpět']),
      el('button',{class:'btn', onclick:async ()=>{
        const nn = prompt('Upravit název zakázky:', job.title);
        if (!nn) return;
        await updateJob(id, { title: nn });
        location.hash = '#/job?id='+id;
      }},['✏️ Upravit zakázku'])
    ])
  ]));

  view.appendChild(invoiceControls(job, inv));

  view.appendChild(entryForm(settings, job, async (data)=>{
    await addEntry(id, data);
    location.hash='#/job?id='+id;
  }));

  // Entries list
  const list = el('div',{class:'card'},[
    el('div',{class:'h1'},['Záznamy práce']),
    entries.length ? el('table',{},[
      el('thead',{},[
        el('tr',{},[
          el('th',{},['Datum']),
          el('th',{},['Čas']),
          el('th',{},['Činnost']),
          el('th',{},['Hodiny / Cena']),
          el('th',{},['Akce'])
        ])
      ]),
      el('tbody',{}, entries.map(e=>{
        const hrs = (e.minutes_total/60);
        return el('tr',{},[
          el('td',{},[e.work_date]),
          el('td',{},[`${e.time_from}–${e.time_to} (pauza ${e.break_minutes}m)`]),
          el('td',{},[e.activity||'']),
          el('td',{},[`${hrs.toFixed(2)} h • ${money(e.price_total)}`]),
          el('td',{},[
            el('button',{class:'btn', onclick: async ()=>{
              // simple edit prompts
              const nd = prompt('Datum (YYYY-MM-DD):', e.work_date) ?? e.work_date;
              const tf = prompt('Od (HH:MM):', e.time_from) ?? e.time_from;
              const tt = prompt('Do (HH:MM):', e.time_to) ?? e.time_to;
              const br = prompt('Pauza (min):', String(e.break_minutes)) ?? String(e.break_minutes);
              const hr = prompt('Sazba Kč/h:', String(e.hour_rate)) ?? String(e.hour_rate);
              const ac = prompt('Činnost:', e.activity) ?? e.activity;
              await updateEntry(e.id, { work_date: nd, time_from: tf, time_to: tt, break_minutes: Number(br), hour_rate: Number(hr), activity: ac });
              location.hash = '#/job?id='+id;
            }},['✏️']),
            el('button',{class:'btn danger', style:'margin-left:6px', onclick: async ()=>{
              if (!confirm('Smazat záznam?')) return;
              await deleteEntry(e.id);
              location.hash = '#/job?id='+id;
            }},['🗑️'])
          ])
        ]);
      }))
    ]) : el('div',{class:'muted'},['Zatím žádné záznamy.'])
  ]);
  view.appendChild(list);
}

async function renderSettings(){
  setActiveTab('/settings');
  const s = await getSettings();
  view.innerHTML='';
  // Facture/company settings
  const phone = el('input',{class:'input', value:s.phone||''});
  const email = el('input',{class:'input', value:s.email||''});
  const rate = el('input',{class:'input', type:'number', step:'1', value:String(s.default_hour_rate||0)});
  const due = el('input',{class:'input', type:'number', step:'1', value:String(s.invoice_due_days_default||14)});

  // Backup controls
  const exportBtn = el('button',{class:'btn primary'},['Vytvořit zálohu (export)']);
  exportBtn.onclick = async ()=>{
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup,null,2)], {type:'application/json'});
    const stamp = new Date().toISOString().replaceAll(':','').slice(0,15);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ravito_denik_backup_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    alert('Záloha byla stažena.');
  };

  const file = el('input',{class:'input', type:'file', accept:'application/json'});
  const importBtn = el('button',{class:'btn danger'},['Obnovit ze zálohy (nahradit vše)']);
  importBtn.onclick = async ()=>{
    const f = file.files?.[0];
    if (!f){ alert('Vyber soubor zálohy (.json)'); return; }
    if (!confirm('Tímto smažeš aktuální data a nahradíš je ze zálohy. Pokračovat?')) return;
    const text = await f.text();
    let obj;
    try { obj = JSON.parse(text); } catch { alert('Neplatný JSON'); return; }
    try {
      await wipeAndRestore(obj);
      alert('Obnoveno. Aplikace se obnoví.');
      location.hash = '#/home';
      location.reload();
    } catch(e){ alert(e.message||String(e)); }
  };

  view.appendChild(el('div',{class:'grid cols2'},[
    el('div',{class:'card'},[
      el('div',{class:'h1'},['Nastavení']),
      el('label',{},['Telefon']),
      phone,
      el('label',{},['Email']),
      email,
      el('label',{},['Default sazba Kč/h']),
      rate,
      el('label',{},['Default splatnost (dny)']),
      due,
      el('div',{class:'row', style:'margin-top:10px'},[
        el('button',{class:'btn primary', onclick: async ()=>{
          await saveSettings({
            phone: phone.value.trim(),
            email: email.value.trim(),
            default_hour_rate: Number(rate.value||0),
            invoice_due_days_default: Number(due.value||14)
          });
          alert('Uloženo.');
          location.hash='#/home';
        }},['Uložit'])
      ])
    ]),
    el('div',{class:'card'},[
      el('div',{class:'h1'},['Data – záloha a obnovení']),
      el('p',{class:'muted small'},['Doporučeno: dělej zálohu pravidelně, hlavně před aktualizacemi telefonu.']),
      el('div',{class:'row'},[ exportBtn ]),
      el('div',{class:'hr'}),
      el('label',{},['Import zálohy (.json)']),
      file,
      el('div',{class:'row', style:'margin-top:10px'},[ importBtn ]),
      el('div',{class:'hr'}),
      el('div',{class:'muted small'},[
        'PWA poznámka: odeslání e-mailem v PWA otevře e-mail klienta; PDF si případně přiložíš po stažení.'
      ])
    ])
  ]));
}

async function render(){
  const { path } = route();
  if (path === '/home') return renderHome();
  if (path === '/jobs') return renderJobs();
  if (path === '/job') return renderJobDetail();
  if (path === '/settings') return renderSettings();
  location.hash = '#/home';
}

window.addEventListener('hashchange', render);

btnSettings?.addEventListener('click', ()=> location.hash = '#/settings');

await ensureDefaults();
render();
