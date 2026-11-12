'use strict';
/* LAPV geoportal: entirely client-side, deployed as static files to GitHub Pages. */
const CONFIG = {
  colors: { SSP245: '#1683c3', SSP370: '#e49a27', SSP585: '#ca526b' },
  dash: { '2050': 'solid', '2070': 'dash', '2085': 'dot' },
  layers: {
    povodi: { url:'data/povodi.geojson', label:'Povodí LAPV' },
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
const state = { map:null, geo:{}, layers:{}, selectedId:null, selectedFeature:null, series:{}, baseBounds:null, loaded:false };
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

function defaultPolygonStyle(){return {color:'#237bb2',weight:1.6,fillColor:'#429cc5',fillOpacity:.16};}
function selectedPolygonStyle(){return {color:'#e96b22',weight:3.2,fillColor:'#f8ab5b',fillOpacity:.34};}
function mapPopup(feature){let p=feature.properties||{};return `<div class="popup-title">${safe(nameOf(feature))}</div><div class="popup-id">ID_Generel: <strong>${safe(p.ID_Generel)}</strong></div>${p.TOK?`<div>Tok: ${safe(p.TOK)}</div>`:''}<div style="margin-top:7px;color:#147baf">Kliknutím vyberete lokalitu pro graf.</div>`;}
function addMapLayer(key, geo){
  if(key==='povodi'){
    const group=L.geoJSON(geo,{style:defaultPolygonStyle(),onEachFeature:(feature,layer)=>{
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
    state.layers[key]=L.geoJSON(geo,{style:{color:'#139fae',weight:1.5,fillColor:'#25bdc3',fillOpacity:.24},onEachFeature:(f,l)=>{l.bindTooltip(safe(nameOf(f)),{sticky:true});l.on('click',()=>selectLocation(f.properties.ID_Generel,true));}});
  }else if(key==='plochy'){
    state.layers[key]=L.geoJSON(geo,{style:{color:'#8b5bba',weight:1.2,fillColor:'#aa7ed0',fillOpacity:.28},onEachFeature:(f,l)=>{l.bindTooltip(safe(nameOf(f)),{sticky:true});l.on('click',()=>selectLocation(f.properties.ID_Generel,true));}});
  }else{
    state.layers[key]=L.geoJSON(geo,{pointToLayer:(f,latlng)=>L.circleMarker(latlng,{radius:4,color:'#fff',weight:1,fillColor:'#e98727',fillOpacity:.9}),onEachFeature:(f,l)=>{l.bindTooltip(safe(nameOf(f)),{sticky:true});l.on('click',()=>selectLocation(f.properties.ID_Generel,true));}});
  }
}
function highlight(){
  const group=state.layers.povodi;if(!group)return;
  let found=null;
  group.eachLayer(layer=>{
    const isSelected=String(layer.feature.properties.ID_Generel)===String(state.selectedId);
    layer.setStyle(isSelected?selectedPolygonStyle():defaultPolygonStyle());
    if(isSelected){layer.bringToFront();found=layer;}
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
function resetAll(){setChoices('scenarioChecks',['SSP245','SSP370','SSP585']);setChoices('periodChecks',['2050']);els.variableSelect.value='P_delta';els.showBand.checked=true;els.showMean.checked=true;selectLocation(state.geo.povodi.features[0].properties.ID_Generel);fitHome();}
function downloadCsv(){
  const combos=visibleCombinationData();if(!combos.length){setStatus('Pro export vyberte alespoň jeden scénář a horizont.',true);return;}
  const lines=['ID_Generel,NAZEV_NADR,SIM,PER,Month,var,val_mean,val_25,val_75,val_min,val_max'];
  const id=state.selectedId;const v=els.variableSelect.value;const name=nameOf(state.selectedFeature);
  const quote=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
  for(const {sc,per,data} of combos)data.forEach((a,i)=>{lines.push([id,quote(name),sc,per,i+1,v,...a].join(','));});
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=`LAPV_${id}_${v}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(href);
}
async function init(){
  ['locationSelect','locationMeta','variableSelect','showBand','showMean','chartHeading','chartSubheading','status'].forEach(id=>els[id]=$(id));
  if(!window.L||!window.Plotly){setStatus('Nepodařilo se načíst Leaflet nebo Plotly. Ověřte připojení k internetu.',true);return;}
  state.map=L.map('map',{preferCanvas:true,zoomControl:true}).setView([49.7,15.3],7);
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
  document.querySelectorAll('#layerChecks input').forEach(i=>i.addEventListener('change',()=>{const layer=state.layers[i.dataset.layer];if(!layer)return;if(i.checked)layer.addTo(state.map);else state.map.removeLayer(layer);if(state.layers.povodi&&state.map.hasLayer(state.layers.povodi))highlight();}));
  $('fitMap').addEventListener('click',fitHome);$('resetAll').addEventListener('click',resetAll);$('downloadCsv').addEventListener('click',downloadCsv);
  window.addEventListener('resize',()=>syncVisualSizes());
}
window.addEventListener('DOMContentLoaded',init);
