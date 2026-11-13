'use strict';
/* LAPV geoportal: entirely client-side, deployed as static files to GitHub Pages. */
const CONFIG = {
  colors: { SSP245: '#1683c3', SSP370: '#e49a27', SSP585: '#ca526b' },
  dash: { '2050': 'solid', '2070': 'dash', '2085': 'dot' },
  layers: {
    povodi: { url:'data/povodi.geojson?v=1.6', label:'Povodí LAPV' },
    zatopy: { url:'data/zatopy.geojson', label:'Zátopy' },
    plochy: { url:'data/MK_plochy.geojson', label:'MK – plochy' },
    body: { url:'data/MK_body.geojson', label:'MK – body' }
  },
  variables: {
    P_delta: { label:'Změna srážek', unit:'%' },
    RM_delta: { label:'Změna odtoku', unit:'%' },
    T_delta: { label:'Změna teploty', unit:'°C' }
  },
  months: ['Led','Úno','Bře','Dub','Kvě','Čvn','Čvc','Srp','Zář','Říj','Lis','Pro']
};
const els = {};
const state = { map:null, geo:{}, layers:{}, selectedId:null, selectedFeature:null, series:{}, baseBounds:null, loaded:false, hydrology:null, climate:null, catalogPromise:null, catalogId:null };
const $ = id => document.getElementById(id);
const selections = container => Array.from(document.querySelectorAll(`#${container} input:checked`)).map(i=>i.value);
const safe = v => String(v == null ? '' : v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setStatus(msg,error=false){els.status.textContent=msg;els.status.classList.toggle('error',error);}
function nameOf(f){const p=f.properties||{};return p.NAZEV_NADR||p.NAZEV||`Lokalita ${p.ID_Generel}`;}
function selectedPeriods(){return selections('periodChecks');}
function selectedScenarios(){return selections('scenarioChecks');}
function fitHome(){if(state.baseBounds && state.baseBounds.isValid()) state.map.fitBounds(state.baseBounds.pad(.07));}
let pendingResizeFrame = 0;
function syncVisualSizes(refit=false){
  if(pendingResizeFrame)cancelAnimationFrame(pendingResizeFrame);
  pendingResizeFrame=requestAnimationFrame(()=>{
    pendingResizeFrame=0;
    if(state.map)state.map.invalidateSize({pan:false});
    if(refit)fitHome();
    if(state.loaded && window.Plotly && $('chart')?._fullLayout){
      try{Plotly.Plots.resize($('chart'));}catch(e){console.warn('Plotly resize:',e);}
    }
  });
}


function ringAreaAbs(ring){
  if(!Array.isArray(ring)||ring.length<3)return 0;
  let sum=0;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[j], b=ring[i];
    sum += (Number(a[0])||0)*(Number(b[1])||0) - (Number(b[0])||0)*(Number(a[1])||0);
  }
  return Math.abs(sum/2);
}
function featureApproxArea(feature){
  const g=feature?.geometry;
  if(!g)return 0;
  if(g.type==='Polygon') return (g.coordinates||[]).reduce((acc,ring,idx)=>acc + (idx===0?1:-1)*ringAreaAbs(ring),0);
  if(g.type==='MultiPolygon') return (g.coordinates||[]).reduce((tot,poly)=>tot + (poly||[]).reduce((acc,ring,idx)=>acc + (idx===0?1:-1)*ringAreaAbs(ring),0),0);
  return 0;
}
function sortFeaturesForClickPriority(geo){
  const sorted={...geo};
  sorted.features=(geo.features||[]).slice().sort((a,b)=>featureApproxArea(b)-featureApproxArea(a));
  return sorted;
}


// Fixed Leaflet pane order: basins < reservoirs < MK polygons < MK points.
// Selection and bringToFront() cannot reorder different panes.
const MAP_PANES = {lapvPovodi:410,lapvZatopy:430,lapvMkPlochy:450,lapvMkBody:470};
function initializeMapPanes(map){
  for(const [name,zIndex] of Object.entries(MAP_PANES)){
    const pane=map.createPane(name);
    pane.style.zIndex=String(zIndex);
  }
}

function defaultPolygonStyle(){return {color:'#237bb2',weight:1.6,fillColor:'#429cc5',fillOpacity:.16};}
function selectedPolygonStyle(){return {color:'#e96b22',weight:3.2,fillColor:'#f8ab5b',fillOpacity:.34};}
function mapPopup(feature){let p=feature.properties||{};return `<div class="popup-title">${safe(nameOf(feature))}</div><div class="popup-id">ID_Generel: <strong>${safe(p.ID_Generel)}</strong></div>${p.TOK?`<div>Tok: ${safe(p.TOK)}</div>`:''}<div style="margin-top:7px;color:#147baf">Kliknutím vyberete lokalitu pro graf.</div>`;}
function addMapLayer(key, geo){
  if(key==='povodi'){
    const group=L.geoJSON(sortFeaturesForClickPriority(geo),{pane:'lapvPovodi',style:defaultPolygonStyle(),onEachFeature:(feature,layer)=>{
      layer.bindTooltip(safe(nameOf(feature)),{sticky:true});
      layer.bindPopup(mapPopup(feature));
      layer.on('click',()=>selectLocation(feature.properties.ID_Generel,true));
      layer.on('mouseover',()=>{if(String(state.selectedId)!==String(feature.properties.ID_Generel))layer.setStyle({weight:2.8,fillOpacity:.26});});
      layer.on('mouseout',()=>{if(String(state.selectedId)!==String(feature.properties.ID_Generel))layer.setStyle(defaultPolygonStyle());});
      layer._lapvFeature=feature;
    }});
    state.layers[key]=group;
    state.baseBounds=group.getBounds();
  }else if(key==='zatopy'){
    state.layers[key]=L.geoJSON(sortFeaturesForClickPriority(geo),{pane:'lapvZatopy',style:defaultZatopaStyle(),onEachFeature:(f,l)=>{l.bindTooltip(safe(nameOf(f))+' \u00b7 katalogov\u00fd list',{sticky:true});l.on('click',()=>{selectLocation(f.properties.ID_Generel,true);openCatalog(f.properties.ID_Generel);});}});
  }else if(key==='plochy'){
    state.layers[key]=L.geoJSON(sortFeaturesForClickPriority(geo),{pane:'lapvMkPlochy',style:{color:'#8b5bba',weight:1.2,fillColor:'#aa7ed0',fillOpacity:.28},onEachFeature:(f,l)=>{l.bindTooltip(safe(nameOf(f)),{sticky:true});l.on('click',()=>selectLocation(f.properties.ID_Generel,true));}});
  }else{
    state.layers[key]=L.geoJSON(geo,{pane:'lapvMkBody',pointToLayer:(f,latlng)=>L.circleMarker(latlng,{pane:'lapvMkBody',radius:4,color:'#fff',weight:1,fillColor:'#e98727',fillOpacity:.9}),onEachFeature:(f,l)=>{l.bindTooltip(safe(nameOf(f)),{sticky:true});l.on('click',()=>selectLocation(f.properties.ID_Generel,true));}});
  }
}
function defaultZatopaStyle(){return {color:'#139fae',weight:1.5,fillColor:'#25bdc3',fillOpacity:.27};}
function selectedZatopaStyle(){return {color:'#cf7923',weight:2.9,fillColor:'#f0ab4a',fillOpacity:.45};}
function highlightZatopy(){
  const group=state.layers.zatopy;
  if(!group)return;
  group.eachLayer(l=>{
    const active=String(l.feature.properties.ID_Generel)===String(state.selectedId);
    l.setStyle(active?selectedZatopaStyle():defaultZatopaStyle());
    // Preserve area-based stacking; larger basins must not cover smaller ones.
  });
}
function highlight(){
  const group=state.layers.povodi;if(!group)return;
  let found=null;
  group.eachLayer(layer=>{
    const isSelected=String(layer.feature.properties.ID_Generel)===String(state.selectedId);
    layer.setStyle(isSelected?selectedPolygonStyle():defaultPolygonStyle());
    if(isSelected){found=layer;} // Area-based order keeps nested basins selectable.
  });
  return found;
}
function selectLocation(id,fromMap=false){
  const feature=state.geo.povodi.features.find(f=>String(f.properties.ID_Generel)===String(id));
  if(!feature)return;
  state.selectedId=String(id);state.selectedFeature=feature;
  els.locationSelect.value=String(id);
  const props=feature.properties;
  els.locationMeta.textContent=`ID_Generel: ${id}${props.TOK?' · Tok: '+props.TOK:''}`;
  const layer=highlight();
  highlightZatopy();
  if(layer && !fromMap) state.map.fitBounds(layer.getBounds().pad(.28),{maxZoom:11});
  renderPlot();updateUrl();
}
function hexRgba(hex,alpha){const h=hex.replace('#','');const n=parseInt(h,16);return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;}
function seriesFor(id,sc,per,v){return state.series[`${id}|${sc}|${per}|${v}`]||null;}
function visibleCombinationData(){
  const rows=[];const v=els.variableSelect.value;
  for(const sc of selectedScenarios())for(const per of selectedPeriods()){
    const data=seriesFor(state.selectedId,sc,per,v);
    if(data)rows.push({sc,per,data});
  }
  return rows;
}
function renderPlot(){
  if(!state.loaded || !state.selectedId)return;
  const variable=els.variableSelect.value;
  const vconf=CONFIG.variables[variable];
  const label=nameOf(state.selectedFeature);
  els.chartHeading.textContent=vconf.label;
  els.chartSubheading.textContent=`${label} · ID_Generel ${state.selectedId} · ${variable}`;
  const traces=[];
  const scenarios=selectedScenarios(),periods=selectedPeriods();
  const combos=visibleCombinationData();
  const band=els.showBand.checked,mean=els.showMean.checked;
  for(const item of combos){
    const {sc,per,data}=item;
    const color=CONFIG.colors[sc];
    const p25=data.map(v=>v[1]),p75=data.map(v=>v[2]),means=data.map(v=>v[0]);
    const label=`${sc} · ${per}`;
    const group=`${sc}_${per}`;
    if(band){
      // IMPORTANT: the 25th-percentile trace must immediately precede the 75th-percentile trace.
      traces.push({x:CONFIG.months,y:p25,type:'scatter',mode:'lines',line:{color:hexRgba(color,.32),width:.8},hoverinfo:'skip',showlegend:false,legendgroup:group});
      traces.push({x:CONFIG.months,y:p75,type:'scatter',mode:'lines',line:{color:hexRgba(color,.32),width:.8},fill:'tonexty',fillcolor:hexRgba(color,combos.length>4?.07:.15),hoverinfo:'skip',showlegend:false,legendgroup:group});
    }
    if(mean){
      traces.push({x:CONFIG.months,y:means,type:'scatter',mode:'lines+markers',name:label,legendgroup:group,line:{color,width:2.5,dash:CONFIG.dash[per]},marker:{size:5,color},hovertemplate:`<b>${safe(label)}</b><br>%{x}: %{y:.2f} ${safe(vconf.unit)}<extra></extra>`});
    }else if(band){
      traces[traces.length-1].showlegend=true;
      traces[traces.length-1].name=label+' (25.–75. percentile)';
    }
  }
  let message='';
  if(!scenarios.length || !periods.length)message='Vyberte alespoň jeden SSP scénář a jeden horizont.';
  else if(!mean && !band)message='Zapněte průměr nebo pás nejistoty.';
  else if(!combos.length)message='Pro zvolenou kombinaci nejsou k dispozici data.';
  else message=`Zobrazeno ${combos.length} kombinací scénáře a horizontu pro ${label}.`;
  setStatus(message);
  const layout={
    autosize:true,margin:{l:62,r:18,t:18,b:62},paper_bgcolor:'white',plot_bgcolor:'white',
    font:{family:'Inter, Segoe UI, Arial, sans-serif',color:'#3b596e',size:11},
    xaxis:{title:{text:'Měsíc',standoff:10},type:'category',categoryorder:'array',categoryarray:CONFIG.months,gridcolor:'#edf2f5',zeroline:false},
    yaxis:{title:{text:`${vconf.label} (${vconf.unit})`,standoff:8},gridcolor:'#e9eff3',zeroline:true,zerolinecolor:'#acbcca',automargin:true},
    hovermode:'x unified',legend:{orientation:'h',y:-.23,x:0,font:{size:10}},showlegend:true,
    annotations:traces.length?[]:[{text:message,showarrow:false,x:.5,y:.5,xref:'paper',yref:'paper',font:{size:13,color:'#7c90a0'}}]
  };
  Plotly.react('chart',traces,layout,{responsive:true,displaylogo:false,modeBarButtonsToRemove:['lasso2d','select2d','zoom2d','pan2d','autoScale2d']});
}
function updateUrl(){
  const url=new URL(window.location.href);
  if(state.selectedId)url.searchParams.set('id',state.selectedId);
  url.searchParams.set('var',els.variableSelect.value);
  url.searchParams.set('sim',selectedScenarios().join(','));
  url.searchParams.set('per',selectedPeriods().join(','));
  window.history.replaceState(null,'',url.pathname+url.search+url.hash);
}
function readUrlOptions(){
  const q=new URLSearchParams(location.search);return {id:q.get('id'),variable:q.get('var'),scenarios:q.get('sim'),periods:q.get('per')};
}
function setChoices(id,values){const set=new Set(values);document.querySelectorAll(`#${id} input`).forEach(el=>{el.checked=set.has(el.value);});}
function resetAll(){setChoices('scenarioChecks',['SSP245']);setChoices('periodChecks',['2050']);els.variableSelect.value='P_delta';els.showBand.checked=true;els.showMean.checked=true;selectLocation(state.geo.povodi.features[0].properties.ID_Generel);fitHome();}
function downloadCsv(){
  const combos=visibleCombinationData();if(!combos.length){setStatus('Pro export vyberte alespoň jeden scénář a horizont.',true);return;}
  const lines=['ID_Generel,NAZEV_NADR,SIM,PER,Month,var,val_mean,val_25,val_75,val_min,val_max'];
  const id=state.selectedId;const v=els.variableSelect.value;const name=nameOf(state.selectedFeature);
  const quote=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
  for(const {sc,per,data} of combos)data.forEach((a,i)=>{lines.push([id,quote(name),sc,per,i+1,v,...a].join(','));});
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=`LAPV_${id}_${v}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(href);
}

// The catalogue is intentionally independent of graph controls. Data are indexed
// by ID_Generel in both JSON datasets, and appear only for 2050/2085 SSP245/585.
const CATALOG_COMBOS=[
  {per:'2050',sim:'SSP245'}, {per:'2050',sim:'SSP585'},
  {per:'2085',sim:'SSP245'}, {per:'2085',sim:'SSP585'}
];
const CATALOG_METRICS=[
  {label:'Sr\u00e1\u017eky P',unit:'mm',key:'p_mm',digits:1},
  {label:'Teplota T',unit:'\u00b0C',key:'t_c',digits:2},
  {label:'V\u00fdpar ET',unit:'mm',key:'et_mm',digits:1},
  {label:'Pr\u016ftok Qa',unit:'m\u00b3/s',key:'qa_m3s',digits:3},
  {label:'MZP',unit:'m\u00b3/s',key:'mzp_m3s',digits:3},
  {label:'Qn \u00b7 Pt 95 %',unit:'m\u00b3/s',key:'qn_m3s',pt:'pt95',digits:3},
  {label:'Qn \u00b7 Pt 99,5 %',unit:'m\u00b3/s',key:'qn_m3s',pt:'pt995',digits:3},
  {label:'Odb\u011br \u00b7 Pt 95 %',unit:'m\u00b3/s',key:'odber_m3s',pt:'pt95',digits:3},
  {label:'Odb\u011br \u00b7 Pt 99,5 %',unit:'m\u00b3/s',key:'odber_m3s',pt:'pt995',digits:3}
];
function fmtCz(value,digits=1){
  const n=Number(value);
  return value===null || value===undefined || !Number.isFinite(n) ? '\u2014' :
    n.toLocaleString('cs-CZ',{minimumFractionDigits:digits,maximumFractionDigits:digits});
}
function fmtCzFlexible(value,maxDigits=2){
  const n=Number(value);
  return value===null || value===undefined || !Number.isFinite(n) ? '\u2014' :
    n.toLocaleString('cs-CZ',{maximumFractionDigits:maxDigits});
}
function catalogRef(record,metric){
  if(!record)return null;
  const raw=record[metric.key];
  return metric.pt ? raw?.[metric.pt] : raw;
}
function catalogFuture(record,combo,metric){
  const raw=record?.[combo.per]?.[combo.sim]?.[metric.key];
  return metric.pt ? raw?.[metric.pt] : raw;
}
async function loadCatalogData(){
  if(state.catalogPromise)return state.catalogPromise;
  state.catalogPromise=Promise.all([
    fetch('data/lapv_hydrologie.json').then(r=>{if(!r.ok)throw Error('Hydrologie: HTTP '+r.status);return r.json();}),
    fetch('data/lapv_klimaticke_scenare.json').then(r=>{if(!r.ok)throw Error('Sc\u00e9n\u00e1\u0159e: HTTP '+r.status);return r.json();})
  ]).then(([hydro,climate])=>{
    if(!hydro.records||!climate.records)throw Error('Nespr\u00e1vn\u00e1 struktura JSON datasetu');
    state.hydrology=hydro;state.climate=climate;
    return true;
  }).catch(e=>{
    console.error('Catalogue data loading failed',e);
    state.catalogPromise=null;
    throw e;
  });
  return state.catalogPromise;
}
function matchingPovodi(id){
  return state.geo.povodi?.features?.find(f=>String(f.properties.ID_Generel)===String(id))?.properties||null;
}
function matchingZatopa(id){
  return state.geo.zatopy?.features?.find(f=>String(f.properties.ID_Generel)===String(id))?.properties||null;
}
function catalogueCard(label,value,unit){
  return `<div class="catalog-stat"><div class="catalog-stat-value">${safe(value)} <small>${safe(unit)}</small></div><div class="catalog-stat-label">${safe(label)}</div></div>`;
}
function renderCatalog(id){
  const hyd=state.hydrology?.records?.[String(id)];
  const future=state.climate?.records?.[String(id)];
  const zatopa=matchingZatopa(id);
  const povodi=matchingPovodi(id);
  $('catalogId').textContent='\u00b7 ID '+id;
  $('catalogTitle').textContent=hyd?.name||zatopa?.NAZEV_NADR||('LAPV '+id);
  $('catalogMeta').textContent=`${zatopa?.TOK?'Tok: '+zatopa.TOK+'  \u00b7  ':''}ID_Generel: ${id}`;
  if(!hyd||!future){
    $('catalogBody').innerHTML=`<div class="catalog-empty">Pro tuto LAPV (${safe(id)}) chyb\u011bj\u00ed hodnoty v hydrologick\u00e9m nebo klimatick\u00e9m datasetu.</div>`;
    $('catalogDownload').disabled=true;
    return;
  }
  $('catalogDownload').disabled=false;
  const cards=[
    catalogueCard('Potenci\u00e1ln\u00ed objem',fmtCzFlexible(hyd.vpot_mil_m3,2),'mil. m\u00b3'),
    catalogueCard('Plocha z\u00e1topy',fmtCz(zatopa?.Plocha,3),'km\u00b2'),
    catalogueCard('Hladina',fmtCzFlexible(hyd.hladina_m_n_m,2),'m n. m.'),
    catalogueCard('V\u00fd\u0161ka hr\u00e1ze',fmtCzFlexible(hyd.vyska_hraze_m,2),'m')
  ].join('');
  const details=[
    catalogueCard('Kategorie n\u00e1dr\u017ee',povodi?.Kategorie??'\u2014',''),
    catalogueCard('Po\u010det MKB',fmtCz(povodi?.['Po\u010det MKB'],0),''),
    catalogueCard('Plocha p\u0159isp\u00edvaj\u00edc\u00edch povod\u00ed MKB',fmtCz(povodi?.['Plocha MKB (km2)'],2),'km\u00b2'),
    catalogueCard('T\u0159\u00edda ohro\u017een\u00ed povod\u00ed eroz\u00ed',fmtCz(povodi?.['T\u0159\u00edda ohro\u017een\u00ed'],0),'')
  ].join('');
  const head=CATALOG_COMBOS.map(c=>`<th scope="col" class="cat-scenario-head"><strong>${c.per}</strong><small>${c.sim}</small></th>`).join('');
  const body=CATALOG_METRICS.map(m=>{
    const baseline=fmtCz(catalogRef(hyd,m),m.digits);
    const values=CATALOG_COMBOS.map(c=>{
      const v=catalogFuture(future,c,m);
      if(!v)return `<td class="cat-number"><span class="cat-mean">\u2014</span></td>`;
      return `<td class="cat-number"><span class="cat-mean">${safe(fmtCz(v.mean,m.digits))}</span>`+
        `<small class="cat-range">${safe(fmtCz(v.p25,m.digits))}\u2013${safe(fmtCz(v.p75,m.digits))}</small></td>`;
    }).join('');
    return `<tr><th scope="row"><span class="cat-metric">${m.label}</span><small class="cat-unit">${m.unit}</small></th>`+
      `<td class="cat-baseline"><span class="cat-mean">${safe(baseline)}</span></td>${values}</tr>`;
  }).join('');
  const nModels=future?.['2050']?.SSP245?.n_models;
  const baselineNote=hyd.nul_var_m3s||{};
  $('catalogBody').innerHTML=`
    <div class="catalog-stat-grid">${cards}</div>
    <div class="catalog-stat-grid catalog-detail-grid">${details}</div>
    <div class="catalog-section-title"><h3>Hydrologick\u00e9 a klimatick\u00e9 charakteristiky</h3>`+
      `<span>${Number.isFinite(nModels)?nModels+' model\u016f':''}</span></div>
    <p class="catalog-swipe-hint">\u2194 Posu\u0148te tabulku do strany pro zobrazen\u00ed sc\u00e9n\u00e1\u0159\u016f.</p>
    <div class="catalog-table-wrap" tabindex="0" role="region" aria-label="Srovn\u00e1vac\u00ed tabulka LAPV">
      <table class="catalog-table"><thead><tr><th scope="col">Ukazatel</th>`+
      `<th scope="col" class="cat-scenario-head cat-ref-head"><strong>2005</strong><small>Referen\u010dn\u00ed</small></th>${head}</tr></thead>`+
      `<tbody>${body}</tbody></table></div>
    <div class="catalog-null">Nulov\u00e1 varianta (2005): Pt 95 % = <strong>${safe(fmtCz(baselineNote.pt95,3))}</strong> m\u00b3/s `+
       `\u00b7 Pt 99,5 % = <strong>${safe(fmtCz(baselineNote.pt995,3))}</strong> m\u00b3/s.</div>
    <p class="catalog-footnote">V bu\u0148k\u00e1ch: naho\u0159e pr\u016fm\u011br, pod n\u00edm interval 25.\u201375. percentilu. `+
      `<strong>2005</strong> ozna\u010duje referen\u010dn\u00ed obdob\u00ed 1991\u20132020. `+
      `2050 = 2035\u20132065; 2085 = 2070\u20132100. `+
      `Sc\u00e9n\u00e1\u0159e SSP245 a SSP585.</p>`;
}
async function openCatalog(id){
  if(!id)return;
  const dialog=$('catalogDialog');
  state.catalogId=String(id);
  $('catalogId').textContent='\u00b7 ID '+id;
  $('catalogTitle').textContent=matchingZatopa(id)?.NAZEV_NADR||'Detail LAPV';
  $('catalogMeta').textContent='ID_Generel: '+id;
  $('catalogBody').innerHTML='<p class="catalog-loading">Na\u010d\u00edt\u00e1m katalogov\u00e1 data...</p>';
  $('catalogDownload').disabled=true;
  if(!dialog.open)dialog.showModal();
  try{
    await loadCatalogData();
    if(dialog.open&&String(state.catalogId)===String(id))renderCatalog(id);
  }catch(e){
    $('catalogBody').innerHTML=`<div class="catalog-empty">Nepoda\u0159ilo se na\u010d\u00edst katalogov\u00e9 datasety. `+
      `Ov\u011b\u0159te, \u017ee jsou na GitHub Pages v adres\u00e1\u0159i data/ soubory `+
      `<code>lapv_hydrologie.json</code> a <code>lapv_klimaticke_scenare.json</code>. `+
      `<br><small>${safe(e.message)}</small></div>`;
  }
}
function closeCatalog(){const dialog=$('catalogDialog');if(dialog.open)dialog.close();}
function downloadCatalogCsv(){
  const id=state.catalogId,hyd=state.hydrology?.records?.[id],future=state.climate?.records?.[id];
  if(!hyd||!future)return;
  const povodi=matchingPovodi(id), zatopa=matchingZatopa(id);
  const header=['ID_Generel','Ukazatel','Jednotka','2005',...CATALOG_COMBOS.flatMap(c=>[`${c.per}_${c.sim}_prumer`,`${c.per}_${c.sim}_p25`,`${c.per}_${c.sim}_p75`])];
  const rows=CATALOG_METRICS.map(m=>[
    id,m.label,m.unit,catalogRef(hyd,m)??'',
    ...CATALOG_COMBOS.flatMap(c=>{
      const v=catalogFuture(future,c,m);
      return [v?.mean??'',v?.p25??'',v?.p75??''];
    })
  ]);
  const metadata=[
    ['Identifikace a technick\u00e9 parametry','Hodnota','Jednotka'],
    ['LAPV',hyd.name,''],
    ['ID_Generel',id,''],
    ['Potenci\u00e1ln\u00ed objem',hyd.vpot_mil_m3??'','mil. m3'],
    ['Plocha z\u00e1topy',zatopa?.Plocha??'','km2'],
    ['Hladina',hyd.hladina_m_n_m??'','m n. m.'],
    ['V\u00fd\u0161ka hr\u00e1ze',hyd.vyska_hraze_m??'','m'],
    ['Kategorie n\u00e1dr\u017ee',povodi?.Kategorie??'',''],
    ['Po\u010det MKB',povodi?.['Po\u010det MKB']??'',''],
    ['Plocha p\u0159isp\u00edvaj\u00edc\u00edch povod\u00ed MKB',povodi?.['Plocha MKB (km2)']??'','km2'],
    ['T\u0159\u00edda ohro\u017een\u00ed povod\u00ed eroz\u00ed',povodi?.['T\u0159\u00edda ohro\u017een\u00ed']??'','']
  ];
  const csv=[...metadata,[],header,...rows].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`LAPV_${id}_katalog.csv`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function init(){
  ['locationSelect','locationMeta','variableSelect','showBand','showMean','chartHeading','chartSubheading','status'].forEach(id=>els[id]=$(id));
  if(!window.L||!window.Plotly){setStatus('Nepodařilo se načíst Leaflet nebo Plotly. Ověřte připojení k internetu.',true);return;}
  state.map=L.map('map',{preferCanvas:false,zoomControl:true}).setView([49.7,15.3],7);
  initializeMapPanes(state.map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(state.map);
  try{
    const entries=await Promise.all([...Object.entries(CONFIG.layers).map(async([k,c])=>{const r=await fetch(c.url);if(!r.ok)throw Error(`HTTP ${r.status}: ${c.url}`);return [k,await r.json()];}),fetch('data/series.json').then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}: series.json`);return r.json();})]);
    for(let i=0;i<4;i++){const [key,geo]=entries[i];state.geo[key]=geo;addMapLayer(key,geo);}
    state.series=entries[4].series;
    state.layers.povodi.addTo(state.map);fitHome();
    const features=state.geo.povodi.features.slice().sort((a,b)=>nameOf(a).localeCompare(nameOf(b),'cs'));
    els.locationSelect.replaceChildren();
    for(const f of features){const option=document.createElement('option');option.value=String(f.properties.ID_Generel);option.textContent=`${nameOf(f)} (${f.properties.ID_Generel})`;els.locationSelect.appendChild(option);}
    state.loaded=true;
    loadCatalogData().catch(()=>{}); // keep graph/map available if catalogue fails
    const q=readUrlOptions();
    if(q.scenarios!==null)setChoices('scenarioChecks',q.scenarios.split(','));
    if(q.periods!==null)setChoices('periodChecks',q.periods.split(','));
    if(q.variable && CONFIG.variables[q.variable])els.variableSelect.value=q.variable;
    const id=features.find(f=>String(f.properties.ID_Generel)===String(q.id))?.properties.ID_Generel ?? features[0].properties.ID_Generel;
    selectLocation(id);fitHome();
    requestAnimationFrame(()=>requestAnimationFrame(()=>syncVisualSizes(true)));
    if(window.ResizeObserver){
      const observer=new ResizeObserver(()=>syncVisualSizes());
      observer.observe($('map'));
      observer.observe($('chart'));
      state.resizeObserver=observer;
    }
  }catch(e){console.error(e);setStatus(`Chyba při načítání dat: ${e.message}. Otevřete aplikaci přes webový server / GitHub Pages.`,true);}
  els.locationSelect.addEventListener('change',e=>selectLocation(e.target.value));
  document.querySelectorAll('#scenarioChecks input,#periodChecks input').forEach(i=>i.addEventListener('change',()=>{renderPlot();updateUrl();}));
  els.variableSelect.addEventListener('change',()=>{renderPlot();updateUrl();});
  els.showBand.addEventListener('change',renderPlot);els.showMean.addEventListener('change',renderPlot);
  document.querySelectorAll('#layerChecks input').forEach(i=>i.addEventListener('change',()=>{const layer=state.layers[i.dataset.layer];if(!layer)return;if(i.checked)layer.addTo(state.map);else state.map.removeLayer(layer);if(state.layers.povodi&&state.map.hasLayer(state.layers.povodi))highlight();if(state.layers.zatopy&&state.map.hasLayer(state.layers.zatopy))highlightZatopy();}));
  $('openCatalogButton').addEventListener('click',()=>openCatalog(state.selectedId));
  $('catalogClose').addEventListener('click',closeCatalog);
  $('catalogDownload').addEventListener('click',downloadCatalogCsv);
  $('catalogPrint').addEventListener('click',()=>window.print());
  $('catalogDialog').addEventListener('click',e=>{if(e.target===$('catalogDialog'))closeCatalog();});
  $('fitMap').addEventListener('click',fitHome);$('resetAll').addEventListener('click',resetAll);$('downloadCsv').addEventListener('click',downloadCsv);
  window.addEventListener('resize',()=>syncVisualSizes());
}
window.addEventListener('DOMContentLoaded',init);
